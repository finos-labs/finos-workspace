from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Annotated
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Request, WebSocket
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, crud, crypto, frame_proxy, helpers, models, schemas, source_proxy, ws_relay
from api.database import aget_read_db, aget_write_db
from api.identity import headers_for as identity_headers
from api.models import ApiSource, FileWidget
from api.models.workspace_models import StoredFile
from api.schemas import SuccessReturn
from api.storage import FileStorage
from api.widget_plugins.broker import readable_backend
from routers import app_helpers
from utilities.config import settings

router = APIRouter(
    prefix="/app/data-connectors",
    tags=["app-data-connectors"],
)


@router.get(
    "/file",
    response_model=list[schemas.ReturnFileWidget],
    summary="List the user's file widgets",
    description=(
        "Returns the file widgets that the signed-in user has created. A user whose type may not add connections "
        "receives an empty list."
    ),
)
async def get_user_file_widgets(
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    if not await app_helpers.may_add_connections(db, user.uuid):
        return []
    select_query = select(FileWidget).where(FileWidget.user_uuid == user.uuid)
    return (await db.execute(select_query)).scalars().all()


@router.post(
    "/file/{widget_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Create or update a file widget",
    description=(
        "Saves the user's file widget under the UUID in the path and links it to the file that the user uploaded, named "
        "by `stored_file_uuid`. Answers 403 when the user's type may not add connections, and 404 when the file is not "
        "stored and no upload of it is pending."
    ),
)
async def post_user_file_widget(
    widget_uuid: Annotated[
        UUID, Path(..., description="The UUID of the widget to create or update")
    ],
    payload: schemas.CreateFileWidget,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    await app_helpers.check_may_add_connections(db, user.uuid)
    cache = settings.redis_cache(payload.stored_file_uuid)
    query = await db.execute(
        select(StoredFile).where(StoredFile.file_widget_uuid == widget_uuid)
    )
    stored_file = query.scalar_one_or_none()

    if stored_file is None and not cache:
        raise HTTPException(404, detail="File not found")

    data = payload.model_dump(exclude={"stored_file_uuid"})

    insert_query = insert(FileWidget).values(
        uuid=widget_uuid, user_uuid=user.uuid, **data
    )
    update_query = (
        update(FileWidget)
        .where(FileWidget.uuid == widget_uuid, FileWidget.user_uuid == user.uuid)
        .values(**data)
    )

    final_query = insert_query if stored_file is None else update_query

    try:
        await db.execute(final_query)
    except IntegrityError as exc:
        helpers.handle_duplicate_pk(exc)
        await db.execute(update_query)

    if stored_file is None:
        confirm_query = (
            update(StoredFile)
            .where(StoredFile.uuid == payload.stored_file_uuid)
            .values(
                file_widget_uuid=widget_uuid,
            )
        )
        await db.execute(confirm_query)
        settings.redis_cache(payload.stored_file_uuid, delete=True)

    await db.commit()
    return {"success": True}


@router.delete(
    "/file/{widget_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Delete a file widget",
    description=(
        "Deletes the user's file widget and, when the storage allows it, the file behind it. A file that the storage "
        "cannot delete is kept and detached from the widget."
    ),
)
async def delete_user_file_widget(
    widget_uuid: Annotated[
        UUID, Path(..., description="The UUID of the widget to delete")
    ],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    stored_file_query = select(StoredFile).where(
        StoredFile.file_widget_uuid == widget_uuid
    )
    stored_file = (await db.execute(stored_file_query)).scalar_one_or_none()

    if stored_file and not await FileStorage.delete_file(
        stored_file.bucket, stored_file.s3_file_name
    ):
        stored_file.file_widget_uuid = None
        await db.commit()

    query = delete(FileWidget).where(
        FileWidget.uuid == widget_uuid, FileWidget.user_uuid == user.uuid
    )
    await db.execute(query)
    await db.commit()
    return {"success": True}


@router.get(
    "/stored-files",
    response_model=list[schemas.StoredFileReturn],
    summary="List the user's stored files",
    description=(
        "Returns the files that the signed-in user has uploaded, each with its extension, size and the file widget that "
        "uses it. A user whose type may not add connections receives an empty list."
    ),
)
async def get_stored_files(
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    if not await app_helpers.may_add_connections(db, user.uuid):
        return []
    select_query = select(StoredFile).where(StoredFile.creater_uuid == user.uuid)
    return (await db.execute(select_query)).scalars().all()


@router.get(
    "/api-source",
    response_model=list[schemas.ReturnApiSource],
    summary="List the backends that the user can manage",
    description=(
        "Returns the backends that the signed-in user can edit, newest first: the user's own backends when the user's "
        "type may add connections, and, for an Admin, the organization's backends as well."
    ),
)
async def get_user_api_sources(
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    filters = ()
    if (
        await app_helpers.get_user_type(db, user.uuid) == models.ADMIN_TYPE
        and (entity_uuid := await crud.get_user_entity_uuid(db, user.permissions_uuid)) is not None
    ):
        filters += (ApiSource.entity_uuid == entity_uuid,)
    if await app_helpers.may_add_connections(db, user.uuid):
        filters += (ApiSource.user_uuid == user.uuid,)
    if not filters:
        return []

    select_query = (
        select(ApiSource).where(or_(*filters)).order_by(ApiSource.updated_date.desc())
    )
    return (await db.execute(select_query)).scalars().all()


@router.post(
    "/api-source/{source_uuid}",
    response_model=SuccessReturn,
    summary="Create or update a backend",
    description=(
        "Saves the user's backend under the UUID in the path with the name, URL and settings in the request: it creates "
        "the backend, or replaces the user's backend that has this UUID. Answers 403 when the user's type may not add "
        "connections."
    ),
)
async def post_user_api_source(
    source_uuid: Annotated[
        UUID, Path(..., description="The UUID of the source to create or update")
    ],
    payload: schemas.CreateApiSource,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    await app_helpers.check_may_add_connections(db, user.uuid)
    insert_query = insert(ApiSource).values(
        uuid=source_uuid, user_uuid=user.uuid, **payload.model_dump()
    )
    try:
        await db.execute(insert_query)
    except IntegrityError as exc:
        helpers.handle_duplicate_pk(exc)
        stored = (
            await db.execute(
                select(ApiSource.url, ApiSource.endpointHeaders).where(
                    ApiSource.uuid == source_uuid, ApiSource.user_uuid == user.uuid
                )
            )
        ).first()
        values = payload.model_dump()
        values["endpointHeaders"] = source_proxy.keep_stored_values(
            stored.endpointHeaders
            if stored and source_proxy.on_origin(str(stored.url), str(values["url"]))
            else None,
            values["endpointHeaders"],
        )
        update_query = (
            update(ApiSource)
            .where(ApiSource.uuid == source_uuid, ApiSource.user_uuid == user.uuid)
            .values(**values)
        )
        await db.execute(update_query)

    await db.commit()
    return SuccessReturn.success_instance()


@router.put(
    "/api-source/{source_uuid}/mcp-servers",
    response_model=SuccessReturn,
    summary="Record the MCP servers that a backend declares",
    description=(
        "Replaces the MCP server URLs that the backend with the given UUID declares, which the web app reports each "
        "time it loads the backend. The users who can read the backend may use these servers with every tool. The "
        "backend's owner can report them, and a superuser can for an organization's backend. Answers 404 to any "
        "other caller."
    ),
)
async def put_api_source_mcp_servers(
    source_uuid: Annotated[
        UUID, Path(..., description="The UUID of the source whose declared MCP servers to record")
    ],
    payload: schemas.ApiSourceMcpServers,
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "is_superuser"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    owned = ApiSource.user_uuid == user.uuid
    editable = or_(owned, ApiSource.entity_uuid.is_not(None)) if user.is_superuser else owned
    source = (
        await db.execute(select(ApiSource).where(ApiSource.uuid == source_uuid, editable))
    ).scalar_one_or_none()
    if source is None:
        raise HTTPException(404, detail="Source not found")
    source.mcp_servers = sorted(set(payload.servers))
    await db.commit()
    return SuccessReturn.success_instance()


@router.delete(
    "/api-source/{source_uuid}",
    response_model=SuccessReturn,
    summary="Delete a backend",
    description=(
        "Deletes the user's own backend with the given UUID. A UUID that is not one of the user's backends is ignored."
    ),
)
async def delete_user_api_source(
    source_uuid: Annotated[
        UUID, Path(..., description="The UUID of the source to delete")
    ],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    query = delete(ApiSource).where(
        ApiSource.uuid == source_uuid, ApiSource.user_uuid == user.uuid
    )
    await db.execute(query)
    await db.commit()
    return SuccessReturn.success_instance()


async def _readable_source(db: AsyncSession, user, source_uuid: UUID):
    try:
        trusted = source_proxy.decided(user.uuid, source_uuid)
        if trusted is None:
            entity_uuid = await crud.get_user_entity_uuid(db, user.permissions_uuid)
            source = await readable_backend(db, user.uuid, entity_uuid, source_uuid)
            if source is not None:
                trusted = await source_proxy.owned_by_superuser(db, source)
                source_proxy.decide(user.uuid, source_uuid, trusted)
        else:
            source = (
                await db.execute(select(models.ApiSource).where(models.ApiSource.uuid == source_uuid))
            ).scalar_one_or_none()
        if source is None:
            raise source_proxy.refused("this data connection is not available to you", 404)
        return source_proxy.snapshot(source), trusted
    finally:
        await db.commit()


@router.post(
    "/api-source/{source_uuid}/request",
    response_class=StreamingResponse,
    summary="Call a data connection from the server",
    description=(
        "Sends the request to the data connection with its stored credentials and the user's email as "
        "`X-Workspace-User`, and streams the answer back with the connection's own status code. Nothing "
        "secret reaches the browser. A refusal by this route carries the header `X-Workspace-Proxy-Error`."
    ),
)
async def request_through_api_source(
    source_uuid: Annotated[UUID, Path(..., description="The UUID of the data connection to call")],
    payload: schemas.SourceRequest,
    request: Request,
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "email", "permissions_uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    await source_proxy.count(user.uuid)
    source, trusted = await _readable_source(db, user, source_uuid)
    signed = await identity_headers(user.uuid, user.email, user.session_uuid, str(source.url))
    url, headers = source_proxy.target_of(source, payload.url, payload.headers, user.email, signed)
    return await source_proxy.send(
        source, payload.method, url, headers, payload.body, payload.accept, user.uuid, trusted=trusted, request=request
    )


@router.post(
    "/api-source-test/request",
    response_class=StreamingResponse,
    summary="Try a data connection from the server before it is saved",
    description=(
        "Like the request of a saved data connection, for credentials being tried in the form: they travel "
        "in this request only and are never stored or returned. A blank value keeps the saved one of the "
        "connection `id`. The address must be a public https one, unless the user is a superuser."
    ),
)
async def request_through_candidate_api_source(
    payload: schemas.SourceTestRequest,
    http_request: Request,
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "email", "permissions_uuid", "is_superuser"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    await source_proxy.count(user.uuid)
    rows = [row.model_dump() for row in payload.endpointHeaders]
    try:
        await app_helpers.check_may_add_connections(db, user.uuid)
        if payload.id is not None:
            entity_uuid = await crud.get_user_entity_uuid(db, user.permissions_uuid)
            stored = await readable_backend(db, user.uuid, entity_uuid, payload.id)
            if stored is None:
                raise source_proxy.refused("this data connection is not available to you", 404)
            rows = source_proxy.keep_stored_values(
                stored.endpointHeaders if source_proxy.on_origin(str(stored.url), str(payload.url)) else None,
                rows,
            )
    finally:
        await db.commit()
    candidate = SimpleNamespace(uuid=payload.id, url=str(payload.url), endpointHeaders=rows, entity_uuid=None)
    request = payload.request
    signed = await identity_headers(user.uuid, user.email, user.session_uuid, candidate.url, provider_token=False)
    url, headers = source_proxy.target_of(candidate, request.url, request.headers, user.email, signed)
    return await source_proxy.send(
        candidate,
        request.method,
        url,
        headers,
        request.body,
        request.accept,
        user.uuid,
        trusted=bool(user.is_superuser),
        request=http_request,
    )


@router.post(
    "/api-source/{source_uuid}/frame",
    response_model=schemas.FrameGrant,
    summary="Open an iframe widget that needs the connection's credentials",
    description=(
        "Reads the connection's own widgets.json and, only when the widget is an iframe widget that declares "
        "`requires_auth`, returns a token that opens that widget's page through this API. The page runs in a "
        "sandbox without storage and the API adds the credentials; neither reaches the browser."
    ),
)
async def grant_frame(
    source_uuid: Annotated[UUID, Path(..., description="The UUID of the data connection")],
    payload: schemas.FrameRequest,
    request: Request,
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "email", "permissions_uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    await source_proxy.count(user.uuid, "frame-grant", source_proxy.GRANTS_PER_MINUTE)
    session_token = request.cookies.get(auth_helpers.SESSION_COOKIE)
    session_uuid = None
    if session_token:
        session_uuid = (
            await db.execute(
                select(models.Session.uuid).where(models.Session.token_hash == crypto.hash_token(session_token))
            )
        ).scalar_one_or_none()
    source, trusted = await _readable_source(db, user, source_uuid)
    signed = await identity_headers(user.uuid, user.email, session_uuid, str(source.url))
    widgets = await source_proxy.fetch_json(source, user.email, trusted, signed)
    page = frame_proxy.page_of(widgets, payload.widget_id, str(source.url))
    token = frame_proxy.issue(user.uuid, source.uuid, payload.widget_id, frame_proxy.directory_of(page), session_uuid)
    return schemas.FrameGrant(token=token, prefix=frame_proxy.directory_of(page), expires_in=frame_proxy.TTL_SECONDS)


async def _frame_access(db: AsyncSession, claims: dict, fresh: bool = False):
    user_uuid, source_uuid = UUID(claims["sub"]), UUID(claims["src"])
    if not fresh and (held := frame_proxy.cached_access(user_uuid, source_uuid)) is not None:
        return held
    try:
        user = (
            await db.execute(select(models.User.email, models.User.permissions_uuid).where(models.User.uuid == user_uuid))
        ).first()
        if user is None:
            raise source_proxy.refused("this page link is not valid", 401)
        if claims.get("sid") and (
            await db.execute(
                select(models.Session.uuid).where(
                    models.Session.uuid == UUID(claims["sid"]), models.Session.expiration_date > datetime.now(UTC)
                )
            )
        ).scalar_one_or_none() is None:
            raise source_proxy.refused("the session that opened this page has ended", 401)
        entity_uuid = await crud.get_user_entity_uuid(db, user.permissions_uuid)
        source = await readable_backend(db, user_uuid, entity_uuid, source_uuid)
        if source is None:
            raise source_proxy.refused("this data connection is not available to you", 404)
        trusted = await source_proxy.owned_by_superuser(db, source)
        frame_proxy.remember_access(user_uuid, source_uuid, source, user.email, trusted)
        return frame_proxy.cached_access(user_uuid, source_uuid)
    finally:
        await db.commit()


def _frame_remainder(scope: dict, fallback: str, token: str) -> str:
    raw = scope.get("raw_path")
    return (raw.decode("latin-1") if raw else fallback).split(f"/frame/{token}", 1)[1].split("?", 1)[0] or "/"


def _frame_session(claims: dict) -> UUID | None:
    return UUID(claims["sid"]) if claims.get("sid") else None


def _frame_url(source, remainder: str, query: str) -> str:
    origin = urlsplit(str(source.url))
    return f"{origin.scheme}://{origin.netloc}{remainder}" + (f"?{query}" if query else "")


@helpers.api_route_per_method(
    router,
    "/frame/{token}/{path:path}",
    ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    response_class=StreamingResponse,
    summary="A page of an iframe widget, with the connection's credentials added",
    description="Authorized by the token in the address alone: the page runs without cookies or storage.",
)
async def frame_page(
    token: Annotated[str, Path(..., description="The token from the frame grant")],
    path: Annotated[str, Path(..., description="The path on the connection's origin")],
    request: Request,
    db: AsyncSession = Depends(aget_read_db),
):
    claims = frame_proxy.read(token)
    remainder = _frame_remainder(request.scope, request.url.path, token)
    if not frame_proxy.allowed(remainder, claims["pre"]):
        raise source_proxy.refused("this page link does not cover that path", 403)
    user_uuid = UUID(claims["sub"])
    await source_proxy.count(user_uuid, "frame-request", source_proxy.FRAME_REQUESTS_PER_MINUTE)
    source, email, trusted = await _frame_access(db, claims)
    signed = await identity_headers(user_uuid, email, _frame_session(claims), str(source.url))
    final_url, headers = source_proxy.target_of(
        source, _frame_url(source, remainder, request.url.query), {}, email, signed
    )
    for name in frame_proxy.FORWARDED_HEADERS:
        if name in request.headers:
            headers[name] = request.headers[name]
    async with source_proxy.buffered(request, frame_proxy.MAX_BODY_BYTES) as body:
        return await source_proxy.send(
            source,
            request.method,
            final_url,
            headers,
            body or None,
            request.headers.get("accept"),
            user_uuid,
            trusted=trusted,
            frame=True,
            request=request,
        )


@router.websocket("/frame/{token}/{path:path}")
async def frame_socket(
    websocket: WebSocket,
    token: str = Path(description="The frame grant that the page received from POST /app/data-connectors/frame"),
    path: str = Path(description="The path below the page's directory that the socket opens"),
    db: AsyncSession = Depends(aget_read_db),
):
    try:
        claims = frame_proxy.read(token)
        remainder = _frame_remainder(websocket.scope, websocket.url.path, token)
        if not frame_proxy.allowed(remainder, claims["pre"]):
            raise source_proxy.refused("this page link does not cover that path", 403)
        await source_proxy.count(UUID(claims["sub"]), "frame-socket", source_proxy.SOCKETS_PER_MINUTE)
        source, email, trusted = await _frame_access(db, claims, fresh=True)
    except HTTPException:
        await websocket.close(code=ws_relay.POLICY_CLOSE_CODE)
        return

    async def authorized() -> bool:
        try:
            await _frame_access(db, claims, fresh=True)
        except HTTPException:
            return False
        return True

    signed = await identity_headers(UUID(claims["sub"]), email, _frame_session(claims), str(source.url))
    url, headers = source_proxy.target_of(
        source, _frame_url(source, remainder, websocket.url.query), {}, email, signed
    )
    origin = urlsplit(str(source.url))
    await ws_relay.relay(
        websocket,
        url,
        headers,
        f"{origin.scheme}://{origin.netloc}",
        trusted,
        UUID(claims["sub"]),
        claims["exp"],
        authorized,
    )
