import asyncio
import contextlib
from functools import partial
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, base, models
from api.database import aget_write_db
from utilities.config import settings

from .auth import (
    WORKSPACE_MCP_TOKEN_TYPE,
    display_token_prefix,
    generate_workspace_mcp_token,
    hash_workspace_mcp_token,
)
from .bridge import BridgeSessionManager, BrowserUnavailableError
from .schemas import (
    BridgeError,
    BrowserSessionStartRequest,
    BrowserSessionStartResponse,
    ErrorEvent,
    SessionReadyEvent,
    TokenCreateRequest,
    TokenCreateResponse,
    TokenMetadata,
)

router = APIRouter(tags=["workspace-mcp"])
bridge_manager = BridgeSessionManager(
    redis_client=(
        settings.get_async_redis_session("app") if not settings.is_test() else None
    )
)
# How often a bridge socket checks that the web session that opened it still lasts
SESSION_CHECK_SECONDS = 10.0


@router.get(
    "/app/workspace-mcp/tokens",
    response_model=list[TokenMetadata],
    dependencies=[Depends(auth_helpers.check_origin)],
)
async def list_tokens(
    user: Annotated[
        auth_helpers.CustomRow, Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True))
    ],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
):
    result = await db.execute(
        select(models.PersonalAccessToken)
        .where(
            models.PersonalAccessToken.user_uuid == user.uuid,
            models.PersonalAccessToken.token_type == WORKSPACE_MCP_TOKEN_TYPE,
            models.PersonalAccessToken.revoked_at.is_(None),
        )
        .order_by(models.PersonalAccessToken.created_date.desc())
    )
    return result.scalars().all()


@router.post(
    "/app/workspace-mcp/tokens",
    response_model=TokenCreateResponse,
    dependencies=[Depends(auth_helpers.check_origin)],
)
async def create_token(
    request: TokenCreateRequest,
    user: Annotated[
        auth_helpers.CustomRow, Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True))
    ],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
):
    raw_token = generate_workspace_mcp_token()
    personal_access_token = models.PersonalAccessToken(
        user_uuid=user.uuid,
        name=request.name,
        token_type=WORKSPACE_MCP_TOKEN_TYPE,
        token_hash=hash_workspace_mcp_token(raw_token),
        token_prefix=display_token_prefix(raw_token),
    )
    db.add(personal_access_token)
    await db.commit()
    await db.refresh(personal_access_token)
    return TokenCreateResponse(
        uuid=personal_access_token.uuid,
        name=personal_access_token.name,
        token_type=personal_access_token.token_type,
        token_prefix=personal_access_token.token_prefix,
        created_date=personal_access_token.created_date,
        updated_date=personal_access_token.updated_date,
        last_used_at=personal_access_token.last_used_at,
        token=raw_token,
    )


@router.delete(
    "/app/workspace-mcp/tokens/{token_uuid}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(auth_helpers.check_origin)],
)
async def revoke_token(
    token_uuid: UUID,
    user: Annotated[
        auth_helpers.CustomRow, Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True))
    ],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
):
    result = await db.execute(
        select(models.PersonalAccessToken).where(
            models.PersonalAccessToken.uuid == token_uuid,
            models.PersonalAccessToken.user_uuid == user.uuid,
            models.PersonalAccessToken.token_type == WORKSPACE_MCP_TOKEN_TYPE,
            models.PersonalAccessToken.revoked_at.is_(None),
        )
    )
    personal_access_token = result.scalar_one_or_none()
    if personal_access_token is not None:
        personal_access_token.revoked_at = base.get_now()
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/app/workspace-mcp/bridge/session/start",
    response_model=BrowserSessionStartResponse,
    dependencies=[Depends(auth_helpers.check_origin)],
)
async def start_bridge_session(
    payload: BrowserSessionStartRequest,
    request: Request,
    user: Annotated[
        auth_helpers.CustomRow, Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True))
    ],
):
    # Behind a reverse proxy that strips a path prefix (nginx rewrites /api/* ->
    # /*), request.base_url loses that prefix, so the websocket_url we build from
    # it would not route back through the proxy. Re-add the prefix the proxy
    # advertises via X-Forwarded-Prefix.
    prefix = request.headers.get("x-forwarded-prefix", "").rstrip("/")
    base_url = str(request.base_url).rstrip("/") + prefix + "/"

    if settings.is_https_deployment() and not base_url.startswith("https://"):
        base_url = base_url.replace("http://", "https://")

    return await bridge_manager.start_session(
        user_uuid=user.uuid, request=payload, base_url=base_url
    )


async def close_when_session_ends(
    web_session: auth_helpers.WebSocketSession, websocket: WebSocket
) -> None:
    """Checks every few seconds, and when the web session expires, that it still lasts;
    once it has ended (or the socket no longer serves) the socket is closed (1008)."""
    while True:
        remaining = (web_session.expiration_date - base.get_now()).total_seconds()
        await asyncio.sleep(min(SESSION_CHECK_SECONDS, max(remaining, 1.0)))
        try:
            await bridge_manager.check_session(web_session.user_uuid, websocket)
        except BrowserUnavailableError:
            with contextlib.suppress(RuntimeError):
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return


@router.websocket("/app/workspace-mcp/bridge/ws")
async def bridge_websocket(websocket: WebSocket):
    """The web app's bridge socket. Before the handshake is accepted it must come from one
    of the web app's origins with a valid web session cookie, for the user's active bridge
    session; otherwise it is refused (1008). It serves while that web session lasts: once
    the session is signed out, replaced by a new sign-in, ended by a password change or
    reset, or expired, the socket is closed (1008), whichever worker holds it."""
    session_id = websocket.query_params.get("session_id", "")
    web_session = await auth_helpers.websocket_session(websocket)
    if web_session is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    user_uuid = web_session.user_uuid
    try:
        await bridge_manager.check_browser(session_id=session_id, user_uuid=user_uuid)
    except BrowserUnavailableError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    try:
        session = await bridge_manager.connect_browser(
            session_id=session_id,
            user_uuid=user_uuid,
            socket=websocket,
            authorized=partial(auth_helpers.web_session_alive, web_session.session_uuid),
        )
    except BrowserUnavailableError as error:
        await websocket.send_json(
            ErrorEvent(
                type="error",
                error=BridgeError(code="unauthorized", message=str(error)),
            ).model_dump(mode="json")
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.send_json(
        SessionReadyEvent(type="session_ready", session=session).model_dump(mode="json")
    )

    watcher = asyncio.create_task(close_when_session_ends(web_session, websocket))
    try:
        while True:
            message = await websocket.receive_json()
            await bridge_manager.handle_browser_message(user_uuid, message, websocket)
    except WebSocketDisconnect:
        pass
    except BrowserUnavailableError:
        with contextlib.suppress(RuntimeError):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    finally:
        watcher.cancel()
        await bridge_manager.disconnect_browser(user_uuid, websocket)
        with contextlib.suppress(RuntimeError):
            await websocket.close()
