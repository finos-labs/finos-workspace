from typing import Annotated

from fastmcp import FastMCP
from pydantic import Field

from workspace_mcp.models import AddGenerativeWidgetCommand, GenerativeWidgetType
from workspace_mcp.server._guidance import DASHBOARD_ID_PARAM, describe_tool
from workspace_mcp.server._helpers import (
    CommandRunner,
    ToolResponse,
    invalid_request,
    literal_values,
    validate_add_generative_widget_request,
)


def register(server: FastMCP, run: CommandRunner) -> None:
    @server.tool(
        description=describe_tool(
            "Create a markdown note or HTML widget from inline content.",
            "The response includes widget_uuid; use that UUID for layout changes.",
            (
                "To place the widget on a new tab, first call manage_navigation_bar "
                "operation='add_tabs', then navigate_workspace to the generated "
                "slug tab_id, then call this tool without inner_tab."
            ),
        )
    )
    async def add_generative_widget(  # noqa: PLR0913, PLR0917
        widget_type: Annotated[
            GenerativeWidgetType,
            Field(
                description=(
                    "Use widget_type='note' for a text note, placed as a markdown "
                    "widget."
                )
            ),
        ],
        dashboard_id: Annotated[
            str | None, Field(description=DASHBOARD_ID_PARAM)
        ] = None,
        data: Annotated[
            str | None,
            Field(description="Content payload: the raw text or HTML content string."),
        ] = None,
        name: Annotated[
            str | None, Field(description="Display name for the new widget.")
        ] = None,
        description: Annotated[
            str | None, Field(description="Short description for the new widget.")
        ] = None,
        inner_tab: Annotated[
            str | None,
            Field(
                description=(
                    "Places the new widget on an existing navigation tab only; "
                    "it does not create a tab."
                )
            ),
        ] = None,
    ) -> ToolResponse:
        allowed_widget_types = literal_values(GenerativeWidgetType)
        if widget_type not in allowed_widget_types:
            return invalid_request(
                "add_generative_widget",
                "add_generative_widget requires widget_type from {note, html}.",
                details={"allowed_widget_types": allowed_widget_types},
            )
        payload_error = validate_add_generative_widget_request(
            widget_type=widget_type,
            data=data,
        )
        if payload_error:
            return invalid_request(
                "add_generative_widget",
                payload_error,
                details={"widget_type": widget_type},
            )
        return await run(
            AddGenerativeWidgetCommand(
                command="add_generative_widget",
                dashboard_id=dashboard_id,
                widget_type=widget_type,
                data=data,
                name=name,
                description=description,
                inner_tab=inner_tab,
            )
        )
