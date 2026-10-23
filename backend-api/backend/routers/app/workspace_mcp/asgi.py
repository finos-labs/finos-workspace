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
    @override
    async def verify_token(self, token: str) -> AccessToken | None:
        async with database.AsyncWriteSessionLocal.session() as db:
            try:
                user_uuid = await validate_workspace_mcp_token(db, token)
            except HTTPException:
                return None
        return AccessToken(
            token=hash_workspace_mcp_token(token),
            client_id=str(user_uuid),
            scopes=[],
            claims={USER_UUID_CLAIM: str(user_uuid)},
        )


class WorkspaceMCPUserMiddleware(Middleware):
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
    server = create_mcp_server(WorkspaceMCPBridgeState(bridge_manager), auth=auth)
    server.add_middleware(WorkspaceMCPUserMiddleware())
    return server


def create_workspace_mcp_asgi_app():
    return create_workspace_mcp_server(auth=WorkspaceMCPTokenVerifier()).http_app(
        path="/mcp",
        transport="streamable-http",
        stateless_http=True,
    )
