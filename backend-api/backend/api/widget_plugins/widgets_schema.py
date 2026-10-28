import copy
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import models
from api.models.widget_plugin_models import PLUGIN_ENABLED, VERSION_ACTIVE

from . import service

KIT_PATH = Path(__file__).with_name("widgets_schema_kit.json")
_REGEX_SPECIAL = re.compile(r"([.^$*+?()\[\]{}|\\/])")


@lru_cache(maxsize=1)
def load_kit() -> dict[str, Any]:
    return json.loads(KIT_PATH.read_text(encoding="utf-8"))


def _kit_digest() -> str:
    return hashlib.sha256(KIT_PATH.read_bytes()).hexdigest()[:16]


def _case_insensitive(text: str) -> str:
    return "".join(f"[{c.lower()}{c.upper()}]" if c.isalpha() else _REGEX_SPECIAL.sub(r"\\\1", c) for c in text)


def forbidden_header_pattern(headers: dict[str, Any]) -> str:
    names = sorted(set(headers["forbidden"]) | set(headers["reserved"]))
    alternatives = [_case_insensitive(n) + "$" for n in names] + [
        _case_insensitive(p) for p in headers["forbiddenPrefixes"]
    ]
    return "^(?:" + "|".join(alternatives) + ")"


def _params_contain(item: dict[str, Any]) -> dict[str, Any]:
    param = {"type": "object", **item}
    return {
        "required": ["params"],
        "properties": {"params": {"contains": {"anyOf": [param, {"type": "array", "contains": param}]}}},
    }


def _param_rule(headers: dict[str, Any]) -> dict[str, Any]:
    return {
        "description": (
            "A header param's paramName is the header name: an HTTP token that a browser lets page "
            "script set and that the Workspace does not set itself; its value is printable ASCII"
        ),
        "if": {"required": ["in"], "properties": {"in": {"const": "header"}}},
        "then": {
            "properties": {
                "paramName": {
                    "type": "string",
                    "pattern": headers["namePattern"],
                    "not": {"pattern": forbidden_header_pattern(headers)},
                },
                "value": {"anyOf": [{"type": "string", "pattern": headers["valuePattern"]}, {"not": {"type": "string"}}]},
            }
        },
    }


def _widget_rules(rules: dict[str, Any], all_locations: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [
        {
            "description": 'Body params are sent only with "method": "POST"',
            "if": _params_contain({"required": ["in"], "properties": {"in": {"const": "body"}}}),
            "then": {"required": ["method"], "properties": {"method": {"const": "POST"}}},
        },
        {
            "description": "A widget kept from the Copilot (disableRetrievalForCopilot) cannot opt in to an MCP tool",
            "if": {
                "required": ["disableRetrievalForCopilot"],
                "properties": {"disableRetrievalForCopilot": {"const": True}},
            },
            "then": {"not": {"required": ["mcp_tool"]}},
        },
    ]
    not_allowed = sorted(set(all_locations) - set(rules["locations"]))
    if not_allowed:
        out.append(
            {
                "description": f"This type's params go in the {' or '.join(rules['locations'])}, not the "
                + " or ".join(not_allowed),
                "not": _params_contain({"required": ["in"], "properties": {"in": {"enum": not_allowed}}}),
            }
        )
    if rules["reservedQueryNames"]:
        names = " and ".join(rules["reservedQueryNames"])
        out.append(
            {
                "description": f"{names}: query params the Workspace adds to this type's requests",
                "not": _params_contain(
                    {
                        "required": ["paramName"],
                        "properties": {"paramName": {"enum": list(rules["reservedQueryNames"])}},
                        "not": {"required": ["in"], "properties": {"in": {"enum": ["header", "body"]}}},
                    }
                ),
            }
        )
    if "raw" in rules["properties"]:
        out.append(
            {
                "description": 'data.rawDataKey and data.rawType describe the rows of raw=true: they need "raw": true',
                "if": {
                    "required": ["data"],
                    "properties": {"data": {"anyOf": [{"required": ["rawDataKey"]}, {"required": ["rawType"]}]}},
                },
                "then": {"required": ["raw"], "properties": {"raw": {"const": True}}},
            }
        )
    return out


def _move_fragment_defs(fragment: dict[str, Any], prefix: str, definitions: dict[str, Any]) -> dict[str, Any]:
    fragment = copy.deepcopy(fragment)
    local = fragment.pop("$defs", None) or {}

    def rewrite(node: Any) -> Any:
        if isinstance(node, dict):
            if isinstance(node.get("$ref"), str) and node["$ref"].startswith("#/$defs/"):
                return {**node, "$ref": f"#/definitions/{prefix}{node['$ref'].removeprefix('#/$defs/')}"}
            return {key: rewrite(value) for key, value in node.items()}
        if isinstance(node, list):
            return [rewrite(value) for value in node]
        return node

    for name, schema in local.items():
        definitions[f"{prefix}{name}"] = rewrite(schema)
    return rewrite(fragment)


def _plugin_config(settings: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": copy.deepcopy((settings or {}).get("properties", {})),
    }


def compose(
    plugin_types: dict[str, dict[str, Any] | None],
    etag: str,
    plugin_settings: dict[str, dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    kit = load_kit()
    base = kit["base"]
    all_locations = list(kit["paramLocations"])
    definitions: dict[str, Any] = {
        "ParamDef": {"allOf": [kit["definitions"]["ParamDef"], _param_rule(kit["headers"])]},
        "McpTool": kit["definitions"]["McpTool"],
    }

    def data_of(rules: dict[str, Any]) -> dict[str, Any]:
        data = copy.deepcopy(kit["data"])
        data["properties"].update(copy.deepcopy(rules["dataProperties"]))
        return data

    def branch(viz_type: str, rules: dict[str, Any], data: dict[str, Any]) -> None:
        properties = copy.deepcopy(base["properties"])
        properties.update(copy.deepcopy(rules["properties"]))
        properties["type"] = {"type": "string", "const": viz_type}
        properties["data"] = {"$ref": f"#/definitions/Data_{viz_type}"}
        if set(rules["methods"]) != set(properties["method"].get("enum", [])):
            properties["method"] = {"type": "string", "enum": list(rules["methods"])}
        definitions[f"Data_{viz_type}"] = data
        definitions[f"Widget_{viz_type}"] = {
            "type": "object",
            "additionalProperties": False,
            "required": [*base["required"], "type"],
            "properties": properties,
            "allOf": _widget_rules(rules, all_locations),
        }

    for viz_type, contract in kit["types"].items():
        branch(viz_type, contract, data_of(contract))
    for viz_type, fragment in sorted(plugin_types.items()):
        data = data_of(kit["pluginTypes"])
        if fragment is not None:
            data["properties"][viz_type] = _move_fragment_defs(fragment, f"Plugin_{viz_type}_", definitions)
        branch(viz_type, kit["pluginTypes"], data)
        definitions[f"PluginConfig_{viz_type}"] = _plugin_config((plugin_settings or {}).get(viz_type))

    types = [*kit["types"], *sorted(plugin_types)]
    definitions["Widget"] = {"oneOf": [{"$ref": f"#/definitions/Widget_{t}"} for t in types]}
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$id": f"urn:workspace:widgets-json:{etag}",
        "title": "widgets.json",
        "type": "object",
        "properties": {"$schema": {"type": "string", "maxLength": 2048}, "$id": {"type": "string", "maxLength": 2048}},
        "propertyNames": {"type": "string", "maxLength": 128},
        "additionalProperties": {"$ref": "#/definitions/Widget"},
        "x-types": types,
        "definitions": definitions,
    }


async def entity_plugin_types(db: AsyncSession, entity_uuid: UUID | None) -> dict[str, dict[str, Any]]:
    if entity_uuid is None:
        return {}
    rows = (
        await db.execute(
            select(models.WidgetPlugin, models.WidgetPluginVersion)
            .join(
                models.WidgetPluginVersion,
                (models.WidgetPluginVersion.plugin_uuid == models.WidgetPlugin.uuid)
                & (models.WidgetPluginVersion.version == models.WidgetPlugin.active_version),
            )
            .join(
                models.EntityWidgetPlugin,
                (models.EntityWidgetPlugin.plugin_uuid == models.WidgetPlugin.uuid)
                & (models.EntityWidgetPlugin.entity_uuid == entity_uuid),
            )
            .where(
                models.WidgetPlugin.status == PLUGIN_ENABLED,
                models.WidgetPluginVersion.state == VERSION_ACTIVE,
                models.EntityWidgetPlugin.enabled.is_(True),
            )
            .order_by(models.WidgetPlugin.plugin_id)
        )
    ).all()
    choices = {
        h.viz_type: (h.plugin_uuid, h.widget_id)
        for h in (
            await db.execute(select(models.EntityVizHandler).where(models.EntityVizHandler.entity_uuid == entity_uuid))
        ).scalars()
    }
    developing = await service.development_versions(db, [plugin for plugin, _version in rows])
    handlers: dict[str, dict[str, Any]] = {}
    for plugin, active in rows:
        version = developing.get(plugin.uuid) or active
        if isinstance(version, service.LiveVersion) and version.errors:
            continue
        for widget in (version.manifest or {}).get("contributes", {}).get("widgets", []):
            for handle in widget.get("handles", []):
                candidate = {
                    "plugin": plugin.plugin_id,
                    "version": version.version,
                    "digest": version.digest,
                    "widget": widget["id"],
                    "definition": handle.get("definition"),
                    "settings": (widget.get("settings") or {}).get("schema"),
                    "response": handle.get("response") or {},
                }
                chosen = choices.get(handle["type"])
                current = handlers.get(handle["type"])
                if chosen == (plugin.uuid, widget["id"]) or current is None:
                    handlers[handle["type"]] = {**candidate, "chosen": chosen == (plugin.uuid, widget["id"])}
                elif not current.get("chosen") and candidate["plugin"] < current["plugin"]:
                    handlers[handle["type"]] = {**candidate, "chosen": False}
    return handlers


MAX_CACHED_SCHEMAS = 256
_cache: dict[str, dict[str, Any]] = {}


async def schema_for_entity(db: AsyncSession, entity_uuid: UUID | None, feature_on: bool) -> tuple[str, dict[str, Any]]:
    handlers = await entity_plugin_types(db, entity_uuid) if feature_on else {}
    inputs = json.dumps(
        {
            "kit": _kit_digest(),
            "types": {t: [h["plugin"], h["version"], h["digest"], h["widget"]] for t, h in sorted(handlers.items())},
        },
        sort_keys=True,
    )
    etag = hashlib.sha256(inputs.encode()).hexdigest()[:32]
    if etag not in _cache:
        if len(_cache) >= MAX_CACHED_SCHEMAS:
            _cache.clear()
        _cache[etag] = compose(
            {t: h["definition"] for t, h in handlers.items()},
            etag,
            {t: h["settings"] for t, h in handlers.items()},
        )
    return etag, _cache[etag]
