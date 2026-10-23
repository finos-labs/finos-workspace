import argparse
import json
import re
import sys
from pathlib import Path

from api.widget_plugins.manifest import VIZ_TYPE_PATTERN
from api.widget_plugins.schema_lint import lint_fragment, lint_settings_schema
from api.widget_plugins.widgets_schema import compose


def _plugin_type(value: str) -> tuple[str, dict]:
    viz_type, _, path = value.partition("=")
    if not viz_type or not path:
        raise argparse.ArgumentTypeError("use <type>=<definition.json>")
    if not re.fullmatch(VIZ_TYPE_PATTERN, viz_type):
        raise argparse.ArgumentTypeError(f"{viz_type!r} is not a widget type name")
    definition = json.loads(Path(path).read_text(encoding="utf-8"))
    problems = lint_fragment(definition)
    if problems:
        raise argparse.ArgumentTypeError(f"{path} is not closed and bounded: " + "; ".join(problems[:5]))
    return viz_type, definition


def _settings(value: str) -> tuple[str, dict]:
    viz_type, _, path = value.partition("=")
    if not viz_type or not path:
        raise argparse.ArgumentTypeError("use <type>=<settings.json>")
    settings = json.loads(Path(path).read_text(encoding="utf-8"))
    problems = lint_settings_schema(settings)
    if problems:
        raise argparse.ArgumentTypeError(f"{path} is not a settings schema: " + "; ".join(problems[:5]))
    return viz_type, settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Print the ``widgets.json`` schema for the built-in types, plus plugin types."
    )
    parser.add_argument("--plugin", action="append", type=_plugin_type, default=[], help="<type>=<definition.json>")
    parser.add_argument("--settings", action="append", type=_settings, default=[], help="<type>=<settings.json>")
    parser.add_argument("--id", default="offline", help="the schema's id suffix")
    args = parser.parse_args(argv)
    plugins, settings = dict(args.plugin), dict(args.settings)
    unknown = sorted(set(settings) - set(plugins))
    if unknown:
        parser.error(f"--settings for a type with no --plugin: {', '.join(unknown)}")
    sys.stdout.write(json.dumps(compose(plugins, args.id, settings), indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
