from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any, get_args
from uuid import uuid4

from workspace_mcp.models import (
    ParamOptionsRequest,
    WidgetDataRequest,
    WorkspaceWidgetConfig,
)
from workspace_mcp.state import BridgeSessionManager

type ToolResponse = dict[str, Any]
type CommandRunner = Callable[[Any], Awaitable[ToolResponse]]

RESULT_REF_URI_TEMPLATE = "workspace://results/{result_id}"


class ResultOffloadStore:
    def __init__(self, max_entries: int = 15):
        self._max_entries = max_entries
        self._entries: dict[str, Any] = {}

    def put(self, data: Any) -> str:
        result_id = uuid4().hex
        self._entries[result_id] = data
        while len(self._entries) > self._max_entries:
            self._entries.pop(next(iter(self._entries)))
        return result_id

    def get(self, result_id: str) -> Any:
        return self._entries[result_id]


def maybe_offload_result(
    result: ToolResponse,
    store: ResultOffloadStore,
    threshold: int,
    *,
    summarize: Callable[[Any], dict[str, Any]],
    message_template: str,
) -> ToolResponse:
    data = result.get("data")
    if not result.get("ok") or data is None:
        return result
    if len(json.dumps(data, default=str)) <= threshold:
        return result

    result_id = store.put(data)
    uri = RESULT_REF_URI_TEMPLATE.format(result_id=result_id)
    compact = summarize(data)
    compact["truncated"] = True
    compact["result_ref"] = uri
    note = message_template.format(uri=uri)
    message = f"{result.get('message') or ''} {note}".strip()
    return {**result, "data": compact, "message": message}


def literal_values(alias: Any) -> list[str]:
    return list(get_args(alias.__value__))


def widget_config(
    *,
    data_args: dict[str, Any] | None,
    ui_args: dict[str, Any] | None,
):
    if data_args is None and ui_args is None:
        return None
    return WorkspaceWidgetConfig(data_args=data_args, ui_args=ui_args)


def required_widget_config(
    *, data_args: dict[str, Any] | None, ui_args: dict[str, Any] | None
):
    return (
        widget_config(data_args=data_args, ui_args=ui_args) or WorkspaceWidgetConfig()
    )


def payload_list(items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return items or []


def has_layout_ui_args(ui_args: dict[str, Any] | None) -> bool:
    if not isinstance(ui_args, dict):
        return False

    return any(
        key in ui_args
        for key in (
            "x",
            "y",
            "w",
            "h",
            "min_w",
            "min_h",
            "max_w",
            "max_h",
            "minW",
            "minH",
            "maxW",
            "maxH",
            "grid_data",
            "gridData",
            "inner_tab",
            "innerTab",
        )
    )


def invalid_request(
    command: str, message: str, *, details: dict[str, Any] | None = None
) -> ToolResponse:
    return {
        "ok": False,
        "command": command,
        "request_id": None,
        "message": message,
        "data": None,
        "error": {
            "code": "invalid_request",
            "message": message,
            "details": details,
            "retryable": False,
        },
        "warnings": [],
    }


def require_widget_identifier(
    command: str, *, widget_uuid: str | None, widget_id: str | None
) -> ToolResponse | None:
    if widget_uuid or widget_id:
        return None
    return invalid_request(
        command,
        f"{command} requires widget_uuid (preferred) or widget_id. "
        "Get widget_uuid from manage_dashboard operation='read' or "
        "get_workspace_snapshot.dashboard_composition.",
        details={"required_one_of": ["widget_uuid", "widget_id"]},
    )


def validate_add_generative_widget_request(
    *,
    widget_type: str,
    data: str | None,
) -> str | None:
    if not isinstance(data, str):
        return (
            f"add_generative_widget with widget_type='{widget_type}' "
            "requires string data."
        )
    return None


def data_source_payloads(items: list[WidgetDataRequest]) -> list[dict[str, Any]]:
    return [
        {
            "origin": item.origin,
            "id": item.widget_id,
            "input_args": item.data_args,
            "widget_uuid": item.widget_uuid,
        }
        for item in items
    ]


def param_options_payloads(items: list[ParamOptionsRequest]) -> list[dict[str, Any]]:
    return [
        {
            "origin": item.origin,
            "id": item.widget_id,
            "param": item.param_name,
            "options_endpoint_input_args": item.data_args,
        }
        for item in items
    ]


def session_context_prompt_content(state: BridgeSessionManager) -> str:
    session = state.get_session_context()
    if session is None:
        return "No FINOS Workspace browser session context is currently available."

    dashboard_id = session.current_dashboard_id or "none"
    tab_id = session.current_tab_id or "none"
    return (
        "Current FINOS Workspace browser session context: "
        f"current_dashboard_id={dashboard_id}; "
        f"current_tab_id={tab_id}."
    )
