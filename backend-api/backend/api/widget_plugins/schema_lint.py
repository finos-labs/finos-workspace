import json
import re
from typing import Any

MAX_FRAGMENT_BYTES = 64 * 1024
MAX_DEPTH = 8
MAX_PATTERN_LENGTH = 256
MAX_SETTINGS_PROPERTIES = 64
MAX_ENUM_VALUES = 100

ANNOTATIONS = {"title", "description", "default", "examples"}
FRAGMENT_KEYWORDS = ANNOTATIONS | {
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "const",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
    "uniqueItems",
    "oneOf",
    "anyOf",
    "$defs",
    "$ref",
}
JSON_TYPES = {"object", "array", "string", "number", "integer", "boolean", "null"}
_BACKREFERENCE = re.compile(r"\\[1-9]|\\k<")


def _pointer(path: list[str]) -> str:
    return "/" + "/".join(p.replace("~", "~0").replace("/", "~1") for p in path)


def _types(node: dict) -> set[str]:
    declared = node.get("type")
    if isinstance(declared, str):
        return {declared}
    if isinstance(declared, list):
        return {t for t in declared if isinstance(t, str)}
    if "properties" in node or "additionalProperties" in node:
        return {"object"}
    if "items" in node:
        return {"array"}
    return set()


def lint_fragment(schema: Any) -> list[str]:  # noqa: PLR0915
    if not isinstance(schema, dict):
        return ["/: must be a JSON Schema object"]
    if len(json.dumps(schema)) > MAX_FRAGMENT_BYTES:
        return [f"/: larger than {MAX_FRAGMENT_BYTES // 1024} KiB"]
    if "object" not in _types(schema):
        return ["/: the root must be an object schema"]

    defs = schema.get("$defs", {})
    problems: list[str] = []

    def check(node: Any, path: list[str], depth: int) -> None:  # noqa: PLR0912, PLR0915
        where = _pointer(path)
        if depth > MAX_DEPTH:
            problems.append(f"{where}: nested deeper than {MAX_DEPTH} levels")
            return
        if not isinstance(node, dict):
            problems.append(f"{where}: must be a schema object")
            return

        unknown = set(node) - FRAGMENT_KEYWORDS
        if unknown:
            problems.append(f"{where}: keywords not allowed: {', '.join(sorted(unknown))}")

        if "$ref" in node:
            ref = node["$ref"]
            if not (isinstance(ref, str) and ref.startswith("#/$defs/") and ref.removeprefix("#/$defs/") in defs):
                problems.append(f"{where}: $ref must name an entry of the local $defs")
            return

        for key in ("oneOf", "anyOf"):
            if key in node:
                options = node[key]
                if not isinstance(options, list) or not options:
                    problems.append(f"{where}/{key}: must be a non-empty list")
                    continue
                for i, option in enumerate(options):
                    check(option, [*path, key, str(i)], depth + 1)
                    if isinstance(option, dict) and "object" not in _types(option) and "$ref" not in option:
                        problems.append(f"{where}/{key}/{i}: {key} is allowed over closed objects only")

        if "enum" in node or "const" in node:
            if "enum" in node and not (isinstance(node["enum"], list) and node["enum"]):
                problems.append(f"{where}/enum: must be a non-empty list")
            return

        types = _types(node)
        if not types and not any(k in node for k in ("oneOf", "anyOf")):
            problems.append(f"{where}: has no type")
        if types - JSON_TYPES:
            problems.append(f"{where}/type: unknown type")

        if "object" in types:
            properties = node.get("properties", {})
            if not isinstance(properties, dict):
                problems.append(f"{where}/properties: must be an object")
                properties = {}
            additional = node.get("additionalProperties")
            if additional is not False:
                if isinstance(additional, dict):
                    check(additional, [*path, "additionalProperties"], depth + 1)
                else:
                    problems.append(f"{where}: additionalProperties must be false, or a value schema for a map")
            required = node.get("required", [])
            if not isinstance(required, list) or not all(isinstance(r, str) and r in properties for r in required):
                problems.append(f"{where}/required: must list declared properties")
            for name, child in properties.items():
                check(child, [*path, "properties", name], depth + 1)

        if "array" in types:
            if not isinstance(node.get("maxItems"), int):
                problems.append(f"{where}: an array needs maxItems")
            if "items" not in node:
                problems.append(f"{where}: an array needs items")
            else:
                check(node["items"], [*path, "items"], depth + 1)

        if "string" in types:
            pattern = node.get("pattern")
            if pattern is not None:
                if not isinstance(pattern, str) or len(pattern) > MAX_PATTERN_LENGTH:
                    problems.append(f"{where}/pattern: at most {MAX_PATTERN_LENGTH} characters")
                elif _BACKREFERENCE.search(pattern):
                    problems.append(f"{where}/pattern: backreferences are not allowed")
                else:
                    try:
                        re.compile(pattern)
                    except re.error:
                        problems.append(f"{where}/pattern: not a valid pattern")
            if not isinstance(node.get("maxLength"), int) and pattern is None:
                problems.append(f"{where}: a string needs maxLength, enum or pattern")

    for name, definition in defs.items() if isinstance(defs, dict) else []:
        check(definition, ["$defs", name], 1)
    check(schema, [], 0)
    return problems


SETTINGS_PROPERTY_KEYWORDS = ANNOTATIONS | {
    "type",
    "enum",
    "minimum",
    "maximum",
    "maxLength",
}
SETTINGS_TYPES = {"string", "number", "integer", "boolean"}


def lint_settings_schema(schema: Any) -> list[str]:  # noqa: PLR0912
    if not isinstance(schema, dict):
        return ["/: must be a JSON Schema object"]
    if schema.get("type", "object") != "object":
        return ["/type: must be object"]
    unknown = set(schema) - {"type", "properties", "required", "title", "description"}
    if unknown:
        return [f"/: keywords not allowed: {', '.join(sorted(unknown))}"]
    properties = schema.get("properties", {})
    if not isinstance(properties, dict) or len(properties) > MAX_SETTINGS_PROPERTIES:
        return [f"/properties: must be an object of at most {MAX_SETTINGS_PROPERTIES} properties"]

    problems: list[str] = []
    for name, prop in properties.items():
        where = f"/properties/{name}"
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name):
            problems.append(f"{where}: property names are letters, digits and underscores")
        if not isinstance(prop, dict):
            problems.append(f"{where}: must be an object")
            continue
        unknown = set(prop) - SETTINGS_PROPERTY_KEYWORDS
        if unknown:
            problems.append(f"{where}: keywords not allowed: {', '.join(sorted(unknown))}")
        if "enum" in prop:
            if not (isinstance(prop["enum"], list) and 0 < len(prop["enum"]) <= MAX_ENUM_VALUES):
                problems.append(f"{where}/enum: a list of 1 to {MAX_ENUM_VALUES} values")
        elif prop.get("type") not in SETTINGS_TYPES:
            problems.append(f"{where}/type: one of {', '.join(sorted(SETTINGS_TYPES))}")
        if prop.get("type") == "string" and "enum" not in prop and not isinstance(prop.get("maxLength"), int):
            problems.append(f"{where}: a string needs maxLength")
    required = schema.get("required", [])
    if not isinstance(required, list) or not all(r in properties for r in required):
        problems.append("/required: must list declared properties")
    return problems


def validate_settings_values(schema: dict, values: Any) -> list[str]:
    if not isinstance(values, dict):
        return ["settings must be an object"]
    properties = schema.get("properties", {})
    problems: list[str] = []
    for key, value in values.items():
        prop = properties.get(key)
        if prop is None:
            problems.append(f"{key}: not a declared setting")
            continue
        if "enum" in prop:
            if value not in prop["enum"]:
                problems.append(f"{key}: not one of the allowed values")
            continue
        kind = prop.get("type")
        ok = {
            "string": isinstance(value, str),
            "boolean": isinstance(value, bool),
            "integer": isinstance(value, int) and not isinstance(value, bool),
            "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        }.get(kind, False)
        if not ok:
            problems.append(f"{key}: must be a {kind}")
            continue
        if kind == "string" and len(value) > prop.get("maxLength", 0):
            problems.append(f"{key}: longer than {prop.get('maxLength')} characters")
        if kind in {"integer", "number"}:
            if "minimum" in prop and value < prop["minimum"]:
                problems.append(f"{key}: below {prop['minimum']}")
            if "maximum" in prop and value > prop["maximum"]:
                problems.append(f"{key}: above {prop['maximum']}")
    for key in schema.get("required", []):
        if key not in values:
            problems.append(f"{key}: required")
    return problems
