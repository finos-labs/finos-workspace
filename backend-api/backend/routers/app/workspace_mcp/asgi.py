from typing import override
from uuid import UUID

from fastapi import HTTPException
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_access_token
from fastmcp.server.middleware import Middleware, MiddlewareContext

from api import database
from workspace_mcp.server import create_mcp_server

from .auth import hash_workspace_mcp_token, validate_workspace_mcp_token
from .bridge_state import WorkspaceMCPBridgeState
from .context import reset_current_user_uuid, set_current_user_uuid
from .router import bridge_manager

USER_UUID_CLAIM = "user_uuid"


class WorkspaceMCPTokenVerifier(TokenVerifier):
    """Accepts the personal access tokens that users create for the Workspace MCP server.

    FastMCP turns a token that this rejects into an HTTP 401 before the MCP transport sees the
    request. Only the ``/mcp`` route is gated: other paths still answer 404, and a GET answers 405.
    """

    @override
    async def verify_token(self, token: str) -> AccessToken | None:
        async with database.AsyncWriteSessionLocal.session() as db:
            try:
                user_uuid = await validate_workspace_mcp_token(db, token)
            except HTTPException:
                return None
        return AccessToken(
            # the hash, so that the secret itself does not travel in the request scope
            token=hash_workspace_mcp_token(token),
            client_id=str(user_uuid),
            scopes=[],
            claims={USER_UUID_CLAIM: str(user_uuid)},
        )


class WorkspaceMCPUserMiddleware(Middleware):
    """Makes the user that owns the bearer token the current user of the request."""

    @override
    async def on_request(self, context: MiddlewareContext, call_next):
        access_token = get_access_token()
        if access_token is None:
            return await call_next(context)

        context_token = set_current_user_uuid(UUID(access_token.claims[USER_UUID_CLAIM]))
        try:
            return await call_next(context)
        finally:
            reset_current_user_uuid(context_token)


def create_workspace_mcp_server(auth: TokenVerifier | None = None):
    """The Workspace MCP server; ``auth`` is what gates it over HTTP."""
    server = create_mcp_server(WorkspaceMCPBridgeState(bridge_manager), auth=auth)
    server.add_middleware(WorkspaceMCPUserMiddleware())
    return server


def create_workspace_mcp_asgi_app():
    return create_workspace_mcp_server(auth=WorkspaceMCPTokenVerifier()).http_app(
        path="/mcp",
        transport="streamable-http",
        stateless_http=True,
    )
