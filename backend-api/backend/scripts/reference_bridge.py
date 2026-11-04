from importlib import import_module
from typing import Any, get_args

import routers.app.workspace_mcp.bridge as bridge_runtime
import routers.app.workspace_mcp.schemas as bridge_schemas
from workspace_mcp import models as bridge_models
from workspace_mcp.server import WIDGETS_JSON_SCHEMA_URI

bridge_router = import_module("routers.app.workspace_mcp.router")

COMMAND_MEANINGS = {
    "get_workspace_snapshot": "Returns a compact snapshot of the dashboards, the current context and the skills.",
    "list_available_widgets": "Lists the widgets that the session can use, optionally for one origin or backend.",
    "get_widget_schema": "Returns the closed schemas for the data arguments and the interface arguments of one widget.",
    "get_widgets_schema": "Returns the composed widgets.json schema of the user's organization.",
    "get_params_options": "Looks up the valid values of widget parameters.",
    "get_widget_data": "Fetches the data of one or more data sources.",
    "read_widget": "Reads one widget of a dashboard.",
    "create_widget": "Creates a widget on a dashboard. With dry_run it only validates.",
    "update_widget": "Changes a widget. With dry_run it only validates.",
    "delete_widget": "Deletes a widget.",
    "manage_dashboard": "Creates, reads or updates a dashboard.",
    "update_dashboard_layout": "Moves or resizes a widget on the dashboard grid.",
    "manage_navigation_bar": "Creates or changes the navigation tabs of a dashboard.",
    "add_generative_widget": "Adds a markdown note or an HTML widget from inline content.",
    "assign_tasks_to_agents": "Assigns tasks to configured external agents.",
    "get_skill_content": "Loads one skill from the skill library.",
    "navigate_workspace": "Moves the tab to a dashboard or to an inner tab.",
    "manage_backends": "Lists, adds, updates, refreshes or removes data backends.",
    "manage_apps": "Lists, reads or instantiates apps, which are dashboard templates.",
}

COMMAND_TOOLS = {"update_dashboard_layout": "update_widget_layout", "get_widgets_schema": None}

MESSAGE_MEANINGS = {
    "session_ready": (
        "The bridge is connected. The session holds its id, the client name and the current dashboard and tab."
    ),
    "command_request": "An MCP client wants the tab to do something. The command names it and carries a request id.",
    "pong": "The answer to a ping.",
    "error": "The API refuses the connection or a message.",
    "command_result": "The tab finished a command.",
    "ping": "A heartbeat.",
    "session_context_changed": (
        "The user moved to another dashboard or tab. The API keeps the new context for the MCP tools."
    ),
}

TO_TAB = (
    bridge_schemas.SessionReadyEvent,
    bridge_schemas.CommandRequestEvent,
    bridge_schemas.PongEvent,
    bridge_schemas.ErrorEvent,
)
TO_API = (
    bridge_schemas.BrowserCommandResultMessage,
    bridge_schemas.BrowserPing,
    bridge_schemas.BrowserSessionContextChangedMessage,
)


def _resolve(node: Any, definitions: dict[str, Any]) -> Any:
    if isinstance(node, dict):
        if "$ref" in node:
            target = _resolve(definitions[node["$ref"].rsplit("/", 1)[1]], definitions)
            return {**target, **{key: value for key, value in node.items() if key not in {"$ref", "title"}}}
        return {key: _resolve(value, definitions) for key, value in node.items() if key != "title"}
    if isinstance(node, list):
        return [_resolve(item, definitions) for item in node]
    return node


def schema_of(model: type) -> dict[str, Any]:
    schema = model.model_json_schema()
    return _resolve({key: value for key, value in schema.items() if key != "$defs"}, schema.get("$defs", {}))


def _type_of(model: type) -> str:
    return model.model_fields["type"].annotation.__args__[0]


def command_models() -> list[type]:
    return list(get_args(get_args(bridge_models.WorkspaceCommand.__value__)[0]))


def _command_name(model: type) -> str:
    return get_args(model.model_fields["command"].annotation)[0]


def _checked(meanings: dict[str, str], names: list[str], what: str) -> None:
    unknown = sorted(set(names) - set(meanings))
    unused = sorted(set(meanings) - set(names))
    if unknown or unused:
        raise ValueError(f"The {what} differ from their descriptions: undescribed {unknown}, unused {unused}")


def collect_workspace_bridge() -> dict[str, Any]:
    models = command_models()
    names = [_command_name(model) for model in models]
    _checked(COMMAND_MEANINGS, names, "bridge commands")
    types = [_type_of(model) for model in (*TO_TAB, *TO_API)]
    _checked(MESSAGE_MEANINGS, types, "bridge messages")
    return {
        "constants": {
            "commandTimeoutSeconds": bridge_runtime.COMMAND_TIMEOUT_SECONDS,
            "presenceTtlSeconds": bridge_runtime.PRESENCE_TTL_SECONDS,
            "sessionTtlSeconds": bridge_runtime.SESSION_TTL_SECONDS,
            "sessionCheckSeconds": bridge_router.SESSION_CHECK_SECONDS,
            "completedResultsMax": bridge_runtime.COMPLETED_RESULTS_MAX,
            "closeCode": bridge_runtime.SESSION_ENDED_CLOSE_CODE,
            "sessionEndedMessage": bridge_runtime.SESSION_ENDED_MESSAGE,
            "noBrowserMessage": bridge_runtime.NO_BROWSER_MESSAGE,
            "sessionReplacedMessage": bridge_runtime.SESSION_REPLACED_MESSAGE,
            "disconnectedMessage": bridge_runtime.BROWSER_DISCONNECTED_MESSAGE,
            "widgetsSchemaResource": WIDGETS_JSON_SCHEMA_URI,
            "webSocketPath": next(
                route.path for route in bridge_router.router.routes if type(route).__name__ == "APIWebSocketRoute"
            ),
        },
        "errorCodes": list(get_args(bridge_models.BridgeErrorCode.__value__)),
        "commands": [
            {
                "name": name,
                "tool": COMMAND_TOOLS.get(name, name),
                "meaning": COMMAND_MEANINGS[name],
                "schema": schema_of(model),
            }
            for name, model in zip(names, models, strict=True)
        ],
        "toTab": [
            {"type": _type_of(model), "meaning": MESSAGE_MEANINGS[_type_of(model)], "schema": schema_of(model)}
            for model in TO_TAB
        ],
        "toApi": [
            {"type": _type_of(model), "meaning": MESSAGE_MEANINGS[_type_of(model)], "schema": schema_of(model)}
            for model in TO_API
        ],
        "result": schema_of(bridge_schemas.WorkspaceCommandResult),
    }
