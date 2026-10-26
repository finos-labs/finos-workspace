import argparse
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic_core import PydanticUndefined

from api.models.model_helpers import Base
from api.widget_plugins.manifest import Manifest
from api.widget_plugins.widgets_schema import compose
from main import app
from scripts.workspace_admin import parser as admin_parser
from utilities.config import Settings

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"

FILES = {
    "openapi": "openapi.json",
    "widgets_schema": "widgets_schema.json",
    "plugin_manifest_schema": "plugin_manifest_schema.json",
    "database_schema": "database_schema.json",
    "settings": "settings.json",
    "admin_cli": "admin_cli.json",
}


def _type_name(annotation: Any) -> str:
    if isinstance(annotation, type):
        return annotation.__name__
    return str(annotation).replace("typing.", "")


def collect_openapi() -> dict[str, Any]:
    schema = app.openapi()
    paths = {path: item for path, item in schema["paths"].items() if path != "/metrics"}
    return {**schema, "paths": paths}


def collect_widgets_schema() -> dict[str, Any]:
    return compose({}, "offline", {})


def collect_plugin_manifest_schema() -> dict[str, Any]:
    return Manifest.model_json_schema()


def _column_type(column: Any) -> str:
    try:
        return str(column.type)
    except Exception:
        return type(column.type).__name__


def collect_database_schema() -> dict[str, Any]:
    tables = []
    for table in sorted(Base.metadata.tables.values(), key=lambda item: item.name):
        columns = []
        for column in table.columns:
            columns.append(
                {
                    "name": column.name,
                    "type": _column_type(column),
                    "nullable": column.nullable,
                    "primary_key": column.primary_key,
                    "unique": bool(column.unique),
                    "indexed": bool(column.index),
                    "server_default": str(column.server_default.arg) if column.server_default is not None else None,
                    "references": [
                        {"column": foreign_key.target_fullname, "on_delete": foreign_key.ondelete}
                        for foreign_key in column.foreign_keys
                    ],
                }
            )
        tables.append(
            {
                "name": table.name,
                "columns": columns,
                "indexes": sorted(
                    [
                        {
                            "name": index.name,
                            "columns": sorted(column.name for column in index.columns),
                            "unique": index.unique,
                        }
                        for index in table.indexes
                    ],
                    key=lambda item: (item["name"] or "", item["columns"]),
                ),
                "unique_constraints": sorted(
                    [
                        {"name": constraint.name, "columns": sorted(column.name for column in constraint.columns)}
                        for constraint in table.constraints
                        if constraint.__class__.__name__ == "UniqueConstraint"
                    ],
                    key=lambda item: (item["name"] or "", item["columns"]),
                ),
            }
        )
    return {"tables": tables}


def collect_settings() -> dict[str, Any]:
    fields = []
    for name, info in Settings.model_fields.items():
        owner = next(
            (klass.__name__ for klass in Settings.__mro__ if name in klass.__dict__.get("__annotations__", {})),
            Settings.__name__,
        )
        required = info.is_required()
        default = None
        if not required and info.default is not PydanticUndefined:
            default = info.default
        fields.append(
            {
                "name": name,
                "group": owner,
                "type": _type_name(info.annotation),
                "required": required,
                "default": default,
                "has_default_factory": info.default_factory is not None,
            }
        )
    return {"fields": sorted(fields, key=lambda item: (item["group"], item["name"]))}


def _describe_parser(parser: argparse.ArgumentParser) -> dict[str, Any]:
    arguments = []
    commands = []
    for action in parser._actions:
        if isinstance(action, argparse._HelpAction):
            continue
        if isinstance(action, argparse._SubParsersAction):
            helps = {choice.dest: choice.help for choice in action._choices_actions}
            for name, sub in action.choices.items():
                commands.append({"name": name, "help": helps.get(name), **_describe_parser(sub)})
            continue
        arguments.append(
            {
                "flags": list(action.option_strings) or [action.dest],
                "positional": not action.option_strings,
                "required": bool(action.required),
                "help": action.help,
                "default": None if action.default is argparse.SUPPRESS else action.default,
                "choices": list(action.choices) if action.choices else None,
                "metavar": action.metavar,
                "multiple": action.nargs in {"*", "+"} or isinstance(action, argparse._AppendAction),
            }
        )
    return {"prog": parser.prog, "description": parser.description, "arguments": arguments, "commands": commands}


def collect_admin_cli() -> dict[str, Any]:
    return _describe_parser(admin_parser())


COLLECTORS: dict[str, Callable[[], dict[str, Any]]] = {
    "openapi": collect_openapi,
    "widgets_schema": collect_widgets_schema,
    "plugin_manifest_schema": collect_plugin_manifest_schema,
    "database_schema": collect_database_schema,
    "settings": collect_settings,
    "admin_cli": collect_admin_cli,
}


def render(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, indent=2, default=str) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the data behind the reference documentation.")
    parser.add_argument("-o", "--output-dir", type=Path, default=FIXTURES, help="directory to write")
    parser.add_argument(
        "-c", "--check", action="store_true", help="verify the existing files match the current code"
    )
    args = parser.parse_args(argv)

    stale = []
    for name, filename in FILES.items():
        content = render(COLLECTORS[name]())
        path = args.output_dir / filename
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                stale.append(str(path))
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        sys.stdout.write(f"wrote {path}\n")
    if stale:
        sys.stderr.write("stale: " + ", ".join(stale) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
