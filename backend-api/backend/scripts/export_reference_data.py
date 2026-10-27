import argparse
import json
import sys
from collections.abc import Callable
from dataclasses import fields as dataclass_fields
from pathlib import Path
from typing import Any, Literal, get_args, get_origin

from pydantic_core import PydanticUndefined

from api.models import widget_plugin_models
from api.models.model_helpers import Base
from api.rate_limit import LIMIT_DEFAULT, LIMIT_FEW
from api.widget_plugins import (
    backends as plugin_backends,
    csp as plugin_csp,
    discovery as plugin_discovery,
    manifest as plugin_manifest,
    metrics as plugin_metrics,
    proxy as plugin_proxy,
    schema_lint as plugin_schema_lint,
    secrets as plugin_secrets,
    service as plugin_service,
)
from api.widget_plugins.manifest import Manifest
from api.widget_plugins.widgets_schema import compose
from main import app
from scripts.reference_bridge import collect_workspace_bridge
from scripts.workspace_admin import parser as admin_parser
from utilities.config import PROMETHEUS_LISTENER_PORT, RQ_QUEUE_NAME, Settings
from workspace_mcp.config import (
    ENV_PREFIX,
    RESULT_OFFLOAD_THRESHOLD_DEFAULT,
    RESULT_OFFLOAD_THRESHOLD_DESCRIPTION,
    Settings as SidecarSettings,
)

OUTPUT = Path(__file__).resolve().parents[1] / "reference-data"

FILES = {
    "openapi": "openapi.json",
    "widgets_schema": "widgets_schema.json",
    "plugin_manifest_schema": "plugin_manifest_schema.json",
    "database_schema": "database_schema.json",
    "settings": "settings.json",
    "admin_cli": "admin_cli.json",
    "widget_plugins": "widget_plugins.json",
    "workspace_bridge": "workspace_bridge.json",
}


def _type_name(annotation: Any) -> str:
    if isinstance(annotation, type):
        return annotation.__name__
    return str(annotation).replace("typing.", "")


def _choices(annotation: Any, extra: Any) -> list[str] | None:
    if isinstance(extra, dict) and "choices" in extra:
        return [str(value) for value in extra["choices"]]
    pending = [annotation]
    while pending:
        part = pending.pop()
        if get_origin(part) is Literal:
            return [str(value) for value in get_args(part)]
        pending.extend(get_args(part))
    return None


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
                "description": info.description or "",
                "choices": _choices(info.annotation, info.json_schema_extra),
            }
        )
    sidecar = SidecarSettings()
    for item in dataclass_fields(SidecarSettings):
        value = getattr(sidecar, item.name)
        fields.append(
            {
                "name": f"{ENV_PREFIX}{item.metadata['env']}",
                "group": "WorkspaceMcpSidecar",
                "type": _type_name(item.type),
                "required": False,
                "default": list(value) if isinstance(value, tuple) else value,
                "has_default_factory": False,
                "description": item.metadata["description"],
                "choices": None,
            }
        )
    fields.append(
        {
            "name": f"{ENV_PREFIX}RESULT_OFFLOAD_THRESHOLD",
            "group": "WorkspaceMcpSidecar",
            "type": "int",
            "required": False,
            "default": RESULT_OFFLOAD_THRESHOLD_DEFAULT,
            "has_default_factory": False,
            "description": RESULT_OFFLOAD_THRESHOLD_DESCRIPTION,
            "choices": None,
        }
    )
    return {
        "constants": {
            "prometheusListenerPort": PROMETHEUS_LISTENER_PORT,
            "queueName": RQ_QUEUE_NAME,
            "rateLimitDefault": LIMIT_DEFAULT,
            "rateLimitFew": LIMIT_FEW,
        },
        "fields": sorted(fields, key=lambda item: (item["group"], item["name"])),
    }


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


PERMISSION_MEANINGS = {
    "core:default": "The lifecycle, error reporting and logs. Every widget always has it.",
    "core:data:read": "Reading the data trait.",
    "core:params:write": (
        "Writing to params and to param:<name>. Only declared names can be written, "
        "and the host coerces each value to the type of its parameter."
    ),
    "core:state:write": "Writing to state.",
    "core:copilot:context": "Letting the host call the module's copilotContext() function.",
    "core:export:provide": "Letting the Export entry call the module's exportOptions() and exportData() functions.",
    "core:ui:notify": "Showing the user a notice, with the command core:ui:notify.",
    "core:ui:open-link": "Opening a link after the user confirms, with the command core:ui:open-link.",
    "core:clipboard:write": "Copying text to the clipboard, with the command core:clipboard:write.",
    "core:download:save": "Saving a file for the user, with the command core:download:save.",
    "core:proxy:call": "Calling a proxy that the widget declares, with the command core:proxy:call.",
    "core:backend:call": (
        "Calling a route of the plugin's backend that the widget declares, with the command core:backend:call."
    ),
}


def _permissions() -> list[dict[str, str]]:
    names = sorted(plugin_manifest.PERMISSIONS)
    unknown = sorted(set(names) - set(PERMISSION_MEANINGS))
    unused = sorted(set(PERMISSION_MEANINGS) - set(names))
    if unknown or unused:
        raise ValueError(f"The permissions differ from their descriptions: undescribed {unknown}, unused {unused}")
    return [{"name": name, "meaning": PERMISSION_MEANINGS[name]} for name in names]


PLUGIN_STATES = {
    "disabled": "The plugin has not been approved yet, so it is off at the deployment.",
    "enabled": "A superuser approved the plugin, and organizations may enable it.",
    "revoked": (
        "The kill switch. The plugin leaves every user's list at its next refresh, "
        "and the API refuses its proxy and backend calls at once. Restoring the plugin undoes it."
    ),
}

VERSION_STATES = {
    "discovered": "The scan found and checked the version, but nobody has approved it.",
    "active": "This is the one version that serves users.",
    "retired": "The version was active once, and it can be approved again.",
    "blocked": (
        "A check failed, or the files changed after discovery. "
        "Versions are immutable, so the deployer has to publish a new version."
    ),
    "missing": (
        "The version's directory is gone. When every version of a plugin is missing, "
        "a superuser can forget the plugin, which deletes its reviews, grants, settings and secrets."
    ),
}


def _states(prefix: str, descriptions: dict[str, str]) -> list[dict[str, str]]:
    values = [
        value
        for name, value in vars(widget_plugin_models).items()
        if name.startswith(prefix) and isinstance(value, str)
    ]
    unknown = sorted(set(values) - set(descriptions))
    unused = sorted(set(descriptions) - set(values))
    if unknown or unused:
        raise ValueError(f"The {prefix} states differ from their descriptions: undescribed {unknown}, unused {unused}")
    return [{"state": value, "meaning": descriptions[value]} for value in values]


def _plugin_metrics() -> list[dict[str, Any]]:
    entries = []
    for value in vars(plugin_metrics).values():
        describe = getattr(value, "describe", None)
        if describe is None or not hasattr(value, "_labelnames"):
            continue
        family = describe()[0]
        name = f"{family.name}_total" if family.type == "counter" else family.name
        entries.append(
            {"name": name, "type": family.type, "labels": list(value._labelnames), "help": family.documentation}
        )
    return sorted(entries, key=lambda item: item["name"])


def collect_widget_plugins() -> dict[str, Any]:
    settings_defaults = {name: info.default for name, info in Settings.model_fields.items()}
    return {
        "host": {"api": plugin_manifest.HOST_API, "afm": plugin_manifest.HOST_AFM},
        "permissions": _permissions(),
        "permissionsLater": sorted(plugin_manifest.PERMISSIONS_LATER),
        "builtInTypes": sorted(plugin_manifest.BUILT_IN_TYPES),
        "traits": list(plugin_manifest.TRAITS),
        "patterns": {
            "pluginId": plugin_manifest.PLUGIN_ID_PATTERN,
            "widgetId": plugin_manifest.WIDGET_ID_PATTERN,
            "vizType": plugin_manifest.VIZ_TYPE_PATTERN,
            "version": plugin_manifest.VERSION_PATTERN,
            "digest": plugin_manifest.DIGEST_PATTERN,
        },
        "package": {
            "manifestFile": plugin_discovery.MANIFEST_FILE,
            "manifestBytes": plugin_discovery.MAX_MANIFEST_BYTES,
            "maxFiles": settings_defaults["WIDGET_PLUGINS_MAX_FILES"],
            "maxUnpackedBytes": settings_defaults["WIDGET_PLUGINS_MAX_UNPACKED_BYTES"],
        },
        "csp": {
            "directives": list(plugin_csp.POLICY_DIRECTIVES),
            "floor": plugin_csp.FLOOR,
            "maxSources": plugin_csp.MAX_SOURCES,
            "maxSourceLength": plugin_csp.MAX_SOURCE_LENGTH,
            "confirmations": [plugin_csp.INSECURE_SCHEME, plugin_csp.PRIVATE_HOST, plugin_csp.REMOTE_SCRIPT],
            "privateSuffixes": list(plugin_csp.PRIVATE_SUFFIXES),
        },
        "reports": {
            "perRequest": plugin_service.MAX_REPORTS_PER_REQUEST,
            "maxOrigins": plugin_service.MAX_REPORT_ORIGINS,
            "maxOriginLength": plugin_service.MAX_REPORT_ORIGIN_LENGTH,
            "retentionDays": plugin_service.REPORT_RETENTION.days,
            "keywords": sorted(plugin_service.REPORT_KEYWORDS),
        },
        "proxy": {
            "acceptedTypes": list(plugin_proxy.ACCEPTED_TYPES),
            "maxBytes": plugin_proxy.MAX_BYTES,
            "maxTimeoutMs": plugin_proxy.MAX_TIMEOUT_MS,
            "forbiddenHeaders": sorted(plugin_proxy.FORBIDDEN_HEADERS),
            "forbiddenHeaderPrefixes": list(plugin_proxy.FORBIDDEN_HEADER_PREFIXES),
            "maxRouteString": plugin_proxy.MAX_ROUTE_STRING,
        },
        "backend": {
            "protocol": plugin_backends.PROTOCOL,
            "tokenPrefix": plugin_backends.TOKEN_PREFIX,
            "tokenSeconds": plugin_backends.TOKEN_SECONDS,
            "secretHeader": plugin_backends.SECRET_HEADER,
            "callHeader": plugin_backends.CALL_HEADER,
            "identityTimeoutSeconds": plugin_backends.IDENTITY_TIMEOUT_SECONDS,
            "identityPath": plugin_backends.IDENTITY_PATH,
            "routePathPrefix": plugin_backends.ROUTE_PATH_PREFIX,
            "identityStates": [
                plugin_backends.IDENTITY_OK,
                plugin_backends.IDENTITY_MISMATCH,
                plugin_backends.IDENTITY_UNREACHABLE,
                plugin_backends.IDENTITY_UNREGISTERED,
            ],
            "maxRouteBytes": plugin_manifest.MAX_ROUTE_BYTES,
        },
        "secrets": {"maxLength": plugin_secrets.MAX_SECRET_LENGTH},
        "schemaLint": {
            "maxFragmentBytes": plugin_schema_lint.MAX_FRAGMENT_BYTES,
            "maxDepth": plugin_schema_lint.MAX_DEPTH,
            "maxPatternLength": plugin_schema_lint.MAX_PATTERN_LENGTH,
            "maxSettingsProperties": plugin_schema_lint.MAX_SETTINGS_PROPERTIES,
            "maxEnumValues": plugin_schema_lint.MAX_ENUM_VALUES,
            "fragmentKeywords": sorted(plugin_schema_lint.FRAGMENT_KEYWORDS),
            "settingsKeywords": sorted(plugin_schema_lint.SETTINGS_PROPERTY_KEYWORDS),
            "settingsTypes": sorted(plugin_schema_lint.SETTINGS_TYPES),
        },
        "states": {
            "plugin": _states("PLUGIN_", PLUGIN_STATES),
            "version": _states("VERSION_", VERSION_STATES),
        },
        "metrics": _plugin_metrics(),
    }


COLLECTORS: dict[str, Callable[[], dict[str, Any]]] = {
    "openapi": collect_openapi,
    "widgets_schema": collect_widgets_schema,
    "plugin_manifest_schema": collect_plugin_manifest_schema,
    "database_schema": collect_database_schema,
    "settings": collect_settings,
    "admin_cli": collect_admin_cli,
    "widget_plugins": collect_widget_plugins,
    "workspace_bridge": collect_workspace_bridge,
}


def render(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, indent=2, default=str) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the data behind the reference documentation.")
    parser.add_argument("-o", "--output-dir", type=Path, default=OUTPUT, help="directory to write")
    args = parser.parse_args(argv)

    for name, filename in FILES.items():
        path = args.output_dir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render(COLLECTORS[name]()), encoding="utf-8")
        sys.stdout.write(f"wrote {path}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
