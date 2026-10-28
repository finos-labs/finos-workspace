from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from api.widget_plugins.widgets_schema import load_kit

RESOURCES = Path(__file__).resolve().parents[1] / "workspace_mcp" / "app_builder" / "resources"
INES_COPY = Path(__file__).resolve().parents[3] / "agent" / "mcp-server" / "src" / "resources" / "app-builder"
MARKER = re.compile(
    r"(<!-- generated:(?P<name>[a-z-]+) -->\n)(?:.*?\n)?(<!-- /generated:(?P=name) -->)",
    re.DOTALL,
)

Node = dict[str, Any]


def _code(value: object) -> str:
    text = value if isinstance(value, str) else json.dumps(value)
    return f"`` {text} ``" if "`" in text else f"`{text}`"


def _number(value: float) -> str:
    return f"{int(value):,}" if float(value).is_integer() else f"{value:g}"


def _description(node: Node, kit: Node) -> str:
    text = node.get("description", "")
    if not text and "$ref" in node:
        text = kit["definitions"][node["$ref"].rsplit("/", 1)[-1]].get("description", "")
    for member in node.get("anyOf", []):
        text = text or _description(member, kit)
    return text[:1].upper() + text[1:]


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


_PLAIN = {"boolean": "`true` or `false`", "object": "object", "null": "`null`"}


def _typed(node: Node, short: bool) -> str:
    kind = node.get("type")
    if kind == "string":
        return f"text, at most {node['maxLength']:,} characters" if "maxLength" in node and not short else "text"
    if kind in {"integer", "number"}:
        word = "whole number" if kind == "integer" else "number"
        low, high = node.get("minimum"), node.get("maximum")
        bounded = low is not None and high is not None and not short
        return f"{word}, {_number(low)} to {_number(high)}" if bounded else word
    if kind == "array":
        items = node.get("items")
        of = f" of {_value(items, short=True)}" if isinstance(items, dict) and "if" not in items else ""
        return f"list{of}, at most {node['maxItems']:,}" if "maxItems" in node and not short else f"list{of}"
    return _PLAIN.get(kind, "any")


def _value(node: Node, short: bool = False) -> str:
    if "$ref" in node or "oneOf" in node:
        text = "object"
    elif "anyOf" in node:
        text = " or ".join(dict.fromkeys(_value(member, short) for member in node["anyOf"]))
    elif "const" in node:
        text = _code(node["const"])
    elif "enum" in node:
        text = ", ".join(_code(v) for v in node["enum"])
    else:
        text = _typed(node, short)
    return text


def _table(header: list[str], rows: list[list[str]]) -> str:
    lines = [
        "| " + " | ".join(header) + " |",
        "|" + "|".join("---" for _ in header) + "|",
    ]
    lines += ["| " + " | ".join(_cell(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def types_block(kit: Node) -> str:
    rows = [
        [
            _code(name),
            contract["summary"],
            contract["returns"],
            " or ".join(contract["methods"]),
            ", ".join(contract["locations"]) + ", or the path",
        ]
        for name, contract in kit["types"].items()
    ]
    return _table(["Type", "Use case", "Endpoint returns", "Method", "Params go in"], rows)


def returns_block(kit: Node) -> str:
    rows = [[_code(name), contract["returns"]] for name, contract in kit["types"].items()]
    return _table(["Widget `type`", "Endpoint returns"], rows)


def widget_fields_block(kit: Node) -> str:
    base = kit["base"]
    required = set(base["required"])
    names = ", ".join(_code(t) for t in kit["types"])
    rows = [
        ["`type`", "Yes", f"{names}, or a plugin type enabled for the organization", "What renders the widget"],
    ]
    for key, node in base["properties"].items():
        value = "list of params" if key == "params" else _value(node)
        rows.append([_code(key), "Yes" if key in required else "No", value, _description(node, kit)])
    rows.append(["`data`", "No", "object", _description(kit["data"], kit)])
    owners: dict[str, tuple[Node, list[str]]] = {}
    for name, contract in kit["types"].items():
        for key, node in contract["properties"].items():
            owners.setdefault(key, (node, []))[1].append(_code(name))
    for key, node in kit["pluginTypes"]["properties"].items():
        owners.setdefault(key, (node, []))[1].append("plugin types")
    for key, (node, types) in owners.items():
        note = _description(node, kit)
        rows.append([_code(key), "No", _value(node), f"Only for {' and '.join(types)}. {note}".strip()])
    return _table(["Field", "Required", "Value", "Notes"], rows)


def _branches(kit: Node) -> list[Node]:
    return kit["definitions"]["ParamDef"]["oneOf"]


def param_fields_block(kit: Node) -> str:
    branches = _branches(kit)
    all_types = [b["properties"]["type"]["const"] for b in branches]
    fields: dict[str, list[tuple[str, Node]]] = {}
    for branch in branches:
        param_type = branch["properties"]["type"]["const"]
        for key, node in branch["properties"].items():
            if key != "type":
                fields.setdefault(key, []).append((param_type, node))

    def which(types: list[str]) -> str:
        if types == all_types:
            return "all"
        if set(all_types) - set(types) == {"form"}:
            return "all but `form`"
        return ", ".join(_code(t) for t in types)

    rows = [["`type`", "all", ", ".join(_code(t) for t in all_types), "The control the param shows"]]
    for key, uses in fields.items():
        types = [t for t, _ in uses]
        values = dict.fromkeys(_value(node) for _, node in uses)
        notes: dict[str, list[str]] = {}
        for param_type, node in uses:
            if text := _description(node, kit):
                notes.setdefault(text, []).append(param_type)
        ordered = sorted(notes.items(), key=lambda item: -len(item[1]))
        note = ". ".join(
            [ordered[0][0], *(f"For {', '.join(_code(t) for t in ts)}: {text}" for text, ts in ordered[1:])]
            if ordered
            else []
        )
        value = next(iter(values)) if len(values) == 1 else "depends on `type`"
        rows.append([_code(key), which(types), value, note])
    return _table(["Field", "Param types", "Value", "Notes"], rows)


def header_names_block(kit: Node) -> str:
    headers = kit["headers"]
    forbidden = ", ".join(_code(name) for name in headers["forbidden"])
    prefixes = ", ".join(_code(prefix) for prefix in headers["forbiddenPrefixes"])
    reserved = ", ".join(_code(name) for name in headers["reserved"])
    return "\n".join(
        [
            f"- The name matches {_code(headers['namePattern'])}: 1 to 64 characters of the HTTP token set.",
            f"- Not a name a browser forbids page script to set, which `fetch` drops silently: {forbidden},"
            f" or a name that starts with {prefixes} (compared without case).",
            f"- Not a name FINOS Workspace sets or reserves: {reserved}.",
            "- Not a header the backend connection's credentials use; checked when the backend is connected.",
            f"- The value matches {_code(headers['valuePattern'])}: printable ASCII, at most 1,024 characters."
            " Any other value stops the request and the param is shown as invalid.",
        ]
    )


BLOCKS: dict[str, tuple[str, Callable[[Node], str]]] = {
    "types": ("specs/widget-types.md", types_block),
    "returns": ("backend-contract.md", returns_block),
    "widget-fields": ("specs/widgets-json.md", widget_fields_block),
    "param-fields": ("specs/widget-parameters.md", param_fields_block),
    "header-names": ("specs/widget-parameters.md", header_names_block),
}


def render(page: str, text: str, kit: Node) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group("name")
        if name not in BLOCKS or BLOCKS[name][0] != page:
            raise SystemExit(f"{page}: no generated block named {name}")
        return match.group(1) + BLOCKS[name][1](kit) + "\n" + match.group(3)

    return MARKER.sub(replace, text)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Writes the lists in the app-builder spec pages from the widgets.json schema kit."
    )
    parser.add_argument("--check", action="store_true", help="fail when a page is stale")
    args = parser.parse_args(argv)
    kit = load_kit()
    stale = []
    pages = {path.relative_to(RESOURCES).as_posix(): path.read_text(encoding="utf-8") for path in RESOURCES.rglob("*.md")}
    for page in sorted({page for page, _ in BLOCKS.values()}):
        path = RESOURCES / page
        text = pages[page]
        for name, (block_page, _) in BLOCKS.items():
            if block_page == page and f"<!-- generated:{name} -->" not in text:
                raise SystemExit(f"{page}: the block {name} has no markers")
        current = render(page, text, kit)
        pages[page] = current
        if current != text:
            stale.append(page)
            if not args.check:
                path.write_text(current, encoding="utf-8")
    if INES_COPY.parent.is_dir():
        copies = {path.relative_to(INES_COPY).as_posix() for path in INES_COPY.rglob("*.md")}
        for page in sorted(copies - pages.keys()):
            stale.append(f"ines:{page}")
            if not args.check:
                (INES_COPY / page).unlink()
        for page, text in sorted(pages.items()):
            copy = INES_COPY / page
            if page in copies and copy.read_text(encoding="utf-8") == text:
                continue
            stale.append(f"ines:{page}")
            if not args.check:
                copy.parent.mkdir(parents=True, exist_ok=True)
                copy.write_text(text, encoding="utf-8")
    if args.check and stale:
        sys.stderr.write(f"stale: {', '.join(stale)}; run python -m scripts.generate_app_builder_specs\n")
        return 1
    sys.stdout.write(("current" if args.check else f"wrote {len(stale)} page(s)") + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
