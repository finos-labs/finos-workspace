"""The Workspace's tools for the agent that runs in the web app.

External hosts use the Workspace MCP server (``workspace_mcp``): they sign in with a personal
access token, and the server reaches the user's browser through a bridge session that the user
opens. The agent that is built into the web app needs neither. The user is signed in, and the tab
the user chats in is the one that runs what the agent asks for.

So the agent is given the same tools as an external host, with the same names, descriptions and
schemas (they come from the same server), and the tab runs a tool when the agent calls it. This
is the backend half: it says which tools there are, and turns a call into the command that the
tab runs.

Both are asked with the user's session token, which the Workspace recognises the way it does
for the chats and the access of the user, and what the user's roles grant applies as it does to
any MCP tool (the tools are those of the server at this endpoint's address).
"""

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
    name: str
    description: str | None = None
    input_schema: dict[str, Any]
    annotations: dict[str, Any] | None = None


class WorkspaceTools(BaseModel):
    model_config = schemas.get_camel_config()
    # The address of the server of these tools, which is what a role grants them by
    url: str
    tools: list[WorkspaceTool]


class WorkspaceToolCall(BaseModel):
    model_config = schemas.get_camel_config()
    name: str = Field(min_length=1, max_length=200)
    arguments: dict[str, Any] = Field(default_factory=dict)


class WorkspaceToolCallResult(BaseModel):
    """What a call comes to: a command for the tab to run, or the answer when there is none to run."""

    model_config = schemas.get_camel_config()
    command: dict[str, Any] | None = None
    result: dict[str, Any] | None = None


_commands: ContextVar[list[dict[str, Any]] | None] = ContextVar("workspace_tools_commands", default=None)


class _CommandCapture:
    """The state of the tools' server that keeps the command a tool builds, not sending it anywhere.

    The tools check their arguments and build the command for the browser; ``execute_command`` is
    where they hand it over. Here it is handed to the caller of ``prepare``, whose tab runs it.
    """

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
    """The address of this endpoint as the client reached it (see ``start_bridge_session``)."""
    prefix = request.headers.get("x-forwarded-prefix", "").rstrip("/")
    base_url = str(request.base_url).rstrip("/") + prefix
    if settings.is_https_deployment() and not base_url.startswith("https://"):
        base_url = base_url.replace("http://", "https://")
    return f"{base_url}{PATH}"


@router.get(PATH, response_model=WorkspaceTools)
async def get_workspace_tools(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """The tools of the Workspace that the user may use, as the agent in the web app is given them."""
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
                # with its references resolved: the agent reads the schema as it is
                input_schema=tool.parameters,
                annotations=(tool.annotations.model_dump(mode="json", exclude_none=True) if tool.annotations else None),
            )
        )
    return WorkspaceTools(url=url, tools=tools)


async def prepare(name: str, arguments: dict[str, Any]) -> WorkspaceToolCallResult:
    """Run a tool far enough to have the command it builds (calls at the same time do not meet)."""
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


@router.post(f"{PATH}/prepare", response_model=WorkspaceToolCallResult)
async def prepare_workspace_tool_call(
    call: WorkspaceToolCall,
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """Check a call of a tool and turn it into the command that the user's tab runs.

    The tools check their own arguments: a call that is not valid has no command, and what is
    returned is the tool's answer, which says what is wrong (as it does for an external host).
    """
    access = await app_helpers.get_user_copilot_access(db, user.uuid)
    if not app_helpers.is_mcp_tool_allowed(access, server_url(request), call.name):
        raise HTTPException(status_code=403, detail=f"You do not have access to the tool `{call.name}`")
    return await prepare(call.name, call.arguments)
