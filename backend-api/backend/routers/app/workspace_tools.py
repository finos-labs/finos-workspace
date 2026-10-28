from contextvars import ContextVar
from functools import cache
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastmcp import FastMCP
from fastmcp.exceptions import NotFoundError, ToolError, ValidationError
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, schemas
from api.database import aget_read_db
from routers.app import helpers as app_helpers
from utilities.config import settings
from workspace_mcp.models import WorkspaceCommandResult, workspace_command_adapter
from workspace_mcp.server import create_mcp_server, invalid_request

router = APIRouter(tags=["workspace-tools"])

PATH = "/app/workspace-tools"


class WorkspaceTool(BaseModel):
    model_config = schemas.get_camel_config()
    name: str = Field(description="The tool's name.")
    description: str | None = Field(None, description="What the tool does.")
    input_schema: dict[str, Any] = Field(description="The JSON Schema of the tool's input.")
    annotations: dict[str, Any] | None = Field(None, description="Hints about the tool, such as whether it only reads.")


class WorkspaceTools(BaseModel):
    model_config = schemas.get_camel_config()
    url: str = Field(description="The address that identifies the tool server.")
    tools: list[WorkspaceTool] = Field(description="The tools that the user's roles allow.")


class WorkspaceToolCall(BaseModel):
    model_config = schemas.get_camel_config()
    name: str = Field(min_length=1, max_length=200, description="The name of the tool to call.")
    arguments: dict[str, Any] = Field(default_factory=dict, description="The tool's arguments.")


class WorkspaceToolCallResult(BaseModel):
    model_config = schemas.get_camel_config()
    command: dict[str, Any] | None = Field(
        None,
        description="The command that the web app carries out in the user's tab.",
    )
    result: dict[str, Any] | None = Field(None, description="The result of a tool that needs no command.")


_commands: ContextVar[list[dict[str, Any]] | None] = ContextVar("workspace_tools_commands", default=None)


class _CommandCapture:
    @staticmethod
    async def execute_command(command: Any) -> WorkspaceCommandResult:
        model = workspace_command_adapter.validate_python(command)
        commands = _commands.get()
        if commands is None:
            raise RuntimeError("A Workspace tool ran outside of a call.")
        commands.append(model.model_dump(mode="json"))
        return WorkspaceCommandResult(ok=True, command=model.command, message="")

    @staticmethod
    def get_session_context() -> None:
        return None


@cache
def _server() -> FastMCP:
    return create_mcp_server(_CommandCapture())  # type: ignore[arg-type]


def server_url(request: Request) -> str:
    prefix = request.headers.get("x-forwarded-prefix", "").rstrip("/")
    base_url = str(request.base_url).rstrip("/") + prefix
    if settings.is_https_deployment() and not base_url.startswith("https://"):
        base_url = base_url.replace("http://", "https://")
    return f"{base_url}{PATH}"


@router.get(
    PATH,
    response_model=WorkspaceTools,
    summary="List the tools that FINOS Workspace offers the Copilot",
    description=(
        "Returns the tools of FINOS Workspace's own MCP server that the signed-in user's roles allow, each with its "
        "name, description and input schema, and the URL that identifies the server."
    ),
)
async def get_workspace_tools(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    url = server_url(request)
    access = await app_helpers.get_user_copilot_access(db, user.uuid)
    tools = []
    for tool in await _server().list_tools():
        if not app_helpers.is_mcp_tool_allowed(access, url, tool.name):
            continue
        tools.append(
            WorkspaceTool(
                name=tool.name,
                description=tool.description,
                input_schema=tool.parameters,
                annotations=(tool.annotations.model_dump(mode="json", exclude_none=True) if tool.annotations else None),
            )
        )
    return WorkspaceTools(url=url, tools=tools)


async def prepare(name: str, arguments: dict[str, Any]) -> WorkspaceToolCallResult:
    commands: list[dict[str, Any]] = []
    token = _commands.set(commands)
    try:
        try:
            outcome = await _server().call_tool(name, arguments)
        except NotFoundError as error:
            raise HTTPException(status_code=404, detail=f"There is no tool `{name}`") from error
        except (ToolError, ValidationError) as error:
            return WorkspaceToolCallResult(result=invalid_request(name, f"{name}: {error}"))
    finally:
        _commands.reset(token)

    if commands:
        return WorkspaceToolCallResult(command=commands[0])
    return WorkspaceToolCallResult(result=outcome.structured_content)


@router.post(
    f"{PATH}/prepare",
    response_model=WorkspaceToolCallResult,
    summary="Prepare a call to one of the tools",
    description=(
        "Validates a call to a tool of FINOS Workspace's own MCP server and returns either the command that the web app "
        "then carries out in the user's tab, or the result of a tool that needs no command. Answers 403 when the user's "
        "roles do not allow the tool and 404 when there is no such tool. A call that fails validation answers with an "
        "invalid request result instead of an error status."
    ),
)
async def prepare_workspace_tool_call(
    call: WorkspaceToolCall,
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    access = await app_helpers.get_user_copilot_access(db, user.uuid)
    if not app_helpers.is_mcp_tool_allowed(access, server_url(request), call.name):
        raise HTTPException(status_code=403, detail=f"You do not have access to the tool `{call.name}`")
    return await prepare(call.name, call.arguments)
