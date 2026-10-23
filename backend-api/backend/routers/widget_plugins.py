import json
import re
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import Row
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, models
from api.database import aget_read_db, aget_write_db
from api.rate_limit import LIMIT_DEFAULT, limiter
from api.widget_plugins import backends, broker, calls, service, widgets_schema
from api.widget_plugins.manifest import PLUGIN_ID_PATTERN, VERSION_PATTERN, WIDGET_ID_PATTERN
from api.widget_plugins.proxy import NAME_PATTERN, PROXY_ID_PATTERN, CallError
from api.widget_plugins.secrets import MAX_SECRET_LENGTH
from routers import app_helpers

TAGS: list[str | Any] = ["widget-plugins"]
PluginId = Annotated[str, StringConstraints(pattern=PLUGIN_ID_PATTERN)]
DATA_SOURCE_PATTERN = r"^[a-z][a-z0-9_-]{0,63}$"

platform_router = APIRouter(prefix="/plugins", tags=TAGS)
admin_router = APIRouter(prefix="/admin", tags=TAGS)
app_router = APIRouter(prefix="/app/widget-plugins", tags=TAGS)
broker_router = APIRouter(prefix="/internal/plugin-broker", tags=TAGS)

closed = ConfigDict(extra="forbid")
MAX_CALL_BODY = 96 * 1024
MAX_INSTANCE_ID = 64


def _checked(value: str, pattern: str, what: str) -> str:
    if not re.fullmatch(pattern, value):
        raise HTTPException(404, detail=f"No such {what}")
    return value


async def _json_object(request: Request, limit: int) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > limit:
        raise HTTPException(413, detail="The body is too large")
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(422, detail="The body is not JSON") from None
    if not isinstance(data, dict):
        raise HTTPException(422, detail="The body is a JSON object")
    return data


class ApproveBody(BaseModel):
    model_config = closed

    digest: Annotated[str, StringConstraints(max_length=80)]
    acknowledged: list[Annotated[str, StringConstraints(max_length=400)]] = Field(default_factory=list, max_length=500)


class OverridesBody(BaseModel):
    model_config = closed

    csp: dict[str, list[str]] | None = None
    server_network: list[Annotated[str, StringConstraints(max_length=255)]] | None = Field(default=None, max_length=32)
    confirmations: list[Literal["insecure-scheme", "private-host", "remote-script"]] = Field(default_factory=list)


class EntityChanges(BaseModel):
    model_config = closed

    enabled: bool | None = None
    narrowed_permissions: list[str] | None = Field(default=None, max_length=32)
    csp_narrow: dict[str, list[str]] | None = None
    server_network_narrow: list[Annotated[str, StringConstraints(max_length=255)]] | None = Field(
        default=None, max_length=32
    )
    data_sources: dict[Annotated[str, StringConstraints(max_length=64)], UUID | None] | None = Field(
        default=None, max_length=16
    )
    settings: dict[str, Any] | None = None
    handlers: dict[str, Annotated[str, StringConstraints(pattern=WIDGET_ID_PATTERN)] | None] | None = None


class AllEntitiesChanges(BaseModel):
    model_config = closed

    enabled: bool


class RoleGrant(BaseModel):
    model_config = closed

    plugin_id: PluginId
    widget_id: Annotated[str, StringConstraints(pattern=r"^(\*|[a-z][a-z0-9_-]{0,47})$")] = "*"


class RoleGrants(BaseModel):
    model_config = closed

    grants: list[RoleGrant] = Field(default_factory=list, max_length=500)


class Report(BaseModel):
    model_config = closed

    directive: Annotated[str, StringConstraints(max_length=32)]
    origin: Annotated[str, StringConstraints(max_length=255)]


FrameFailure = Literal["sandbox-failed", "integrity-failed", "load-failed", "plugin-error", "unresponsive", "ended"]


class ReportBody(BaseModel):
    model_config = closed

    plugin_id: PluginId
    version: Annotated[str, StringConstraints(pattern=VERSION_PATTERN)]
    reports: list[Report] = Field(default_factory=list, max_length=50)
    failure: FrameFailure | None = None


@platform_router.get("")
async def list_plugins(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    _: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await service.platform_listing(db)


@platform_router.get("/{plugin_id}")
async def get_plugin(
    plugin_id: PluginId,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    _: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await service.platform_plugin(db, plugin_id)


@platform_router.post("/rescan")
async def rescan_plugins(
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await service.rescan(db, superuser.uuid)


@platform_router.post("/{plugin_id}/versions/{version}/approve")
async def approve_version(
    plugin_id: PluginId,
    version: Annotated[str, StringConstraints(pattern=VERSION_PATTERN)],
    body: ApproveBody,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await service.approve(
        db,
        plugin_id,
        version,
        digest=body.digest,
        acknowledged=body.acknowledged,
        actor_uuid=superuser.uuid,
    )


@platform_router.post("/{plugin_id}/revoke")
async def revoke_plugin(
    plugin_id: PluginId,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await service.set_status(db, plugin_id, True, superuser.uuid)


@platform_router.post("/{plugin_id}/restore")
async def restore_plugin(
    plugin_id: PluginId,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await service.set_status(db, plugin_id, False, superuser.uuid)


@platform_router.put("/{plugin_id}/overrides")
async def put_overrides(
    plugin_id: PluginId,
    body: OverridesBody,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await service.set_overrides(
        db, plugin_id, body.csp, body.server_network, list(body.confirmations), superuser.uuid
    )


@platform_router.post("/{plugin_id}/backend/check")
async def check_plugin_backend(
    plugin_id: PluginId,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    _: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await calls.check_backend(db, plugin_id)


@platform_router.put("/{plugin_id}/secrets/{name}")
async def put_plugin_secret(
    plugin_id: str,
    name: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    body = await _json_object(request, MAX_SECRET_LENGTH * 2)
    if set(body) != {"value"} or not isinstance(body["value"], str):
        raise HTTPException(422, detail='The body is {"value": "<the secret>"}')
    await service.set_secret(
        db,
        _checked(plugin_id, PLUGIN_ID_PATTERN, "plugin"),
        _checked(name, NAME_PATTERN, "secret"),
        body["value"],
        superuser.uuid,
    )
    return {"success": True}


@platform_router.delete("/{plugin_id}/secrets/{name}")
async def delete_plugin_secret(
    plugin_id: PluginId,
    name: Annotated[str, StringConstraints(pattern=NAME_PATTERN)],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    await service.clear_secret(db, plugin_id, name, superuser.uuid)
    return {"success": True}


@platform_router.put("/{plugin_id}/entities")
async def put_plugin_all_entities(
    plugin_id: PluginId,
    body: AllEntitiesChanges,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    count = await service.update_all_entities(
        db, plugin_id, body.model_dump(mode="json", exclude_unset=True), superuser.uuid
    )
    return {"success": True, "entities": count}


@platform_router.put("/{plugin_id}/entities/{entity_uuid}")
async def put_plugin_entity(
    plugin_id: PluginId,
    entity_uuid: UUID,
    body: EntityChanges,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    if await db.get(models.Entity, entity_uuid) is None:
        raise HTTPException(404, detail="Entity not found")
    await service.update_entity(
        db, entity_uuid, plugin_id, body.model_dump(mode="json", exclude_unset=True), superuser.uuid
    )
    return {"success": True}


@platform_router.get("/{plugin_id}/events")
async def get_plugin_events(
    plugin_id: PluginId,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    _: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await service.plugin_events(db, plugin_id)


@platform_router.get("/{plugin_id}/csp-reports")
async def get_plugin_reports(
    plugin_id: PluginId,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    _: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    return await service.list_reports(db, plugin_id)


@platform_router.delete("/{plugin_id}")
async def forget_plugin(
    plugin_id: PluginId,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    _: Annotated[models.User, Depends(auth_helpers.get_current_superuser)],
):
    await service.forget(db, plugin_id)
    return {"success": True}


async def _admin_entity(db: AsyncSession, admin: Row) -> UUID:
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if entity_uuid is None:
        raise HTTPException(404, detail="Entity not found")
    return entity_uuid


@admin_router.get("/plugins")
async def list_entity_plugins(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    entity_uuid = await _admin_entity(db, admin)
    return {
        "enabled": service.feature_enabled(),
        "plugins": await service.entity_listing(db, entity_uuid),
        "backends": await service.entity_backends(db, entity_uuid),
    }


@admin_router.put("/plugins/{plugin_id}")
async def put_entity_plugin(
    plugin_id: PluginId,
    body: EntityChanges,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    await service.update_entity(
        db, await _admin_entity(db, admin), plugin_id, body.model_dump(mode="json", exclude_unset=True), admin.uuid
    )
    return {"success": True}


@admin_router.get("/plugins/{plugin_id}/csp-reports")
async def get_entity_plugin_reports(
    plugin_id: PluginId,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    return await service.list_reports(db, plugin_id, await _admin_entity(db, admin))


@admin_router.get("/plugins/{plugin_id}/events")
async def get_entity_plugin_events(
    plugin_id: PluginId,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    return await service.plugin_events(db, plugin_id, await _admin_entity(db, admin))


@admin_router.get("/role/{role_uuid}/plugin-access", response_model=RoleGrants)
async def get_role_plugin_access(
    role_uuid: UUID,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    if not await app_helpers.role_exists(db, role_uuid, await _admin_entity(db, admin)):
        raise HTTPException(404, detail="Role not found")
    return {"grants": await service.get_role_grants(db, role_uuid)}


@admin_router.put("/role/{role_uuid}/plugin-access")
async def put_role_plugin_access(
    role_uuid: UUID,
    body: RoleGrants,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    if not await app_helpers.role_exists(db, role_uuid, await _admin_entity(db, admin)):
        raise HTTPException(404, detail="Role not found")
    await service.set_role_grants(db, role_uuid, [g.model_dump() for g in body.grants])
    return {"success": True}


@app_router.get("")
@limiter.limit(LIMIT_DEFAULT)
async def get_available_plugins(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    listing = await service.user_listing(db, user.uuid)
    response.headers["Cache-Control"] = "private, no-cache"
    response.headers["ETag"] = f'"{listing["etag"]}"'
    return listing


@app_router.get("/widgets-schema")
@limiter.limit(LIMIT_DEFAULT)
async def get_widgets_schema(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "is_superuser"], app_session=True)),
    entity: UUID | None = None,
):
    if entity is not None and not user.is_superuser:
        raise HTTPException(403, detail="Only a superuser may read another entity's schema")
    entity_uuid = entity if entity is not None else await service.user_entity(db, user.uuid)
    etag, schema = await widgets_schema.schema_for_entity(db, entity_uuid, service.feature_enabled())
    response.headers["Cache-Control"] = "private, no-cache"
    response.headers["ETag"] = f'"{etag}"'
    if request.headers.get("if-none-match") == f'"{etag}"':
        return Response(status_code=304, headers={"ETag": f'"{etag}"', "Cache-Control": "private, no-cache"})
    return schema


@app_router.get("/{plugin_id}/{digest}/files/{file_path:path}")
async def get_plugin_file(
    plugin_id: PluginId,
    digest: Annotated[str, StringConstraints(max_length=80)],
    file_path: Annotated[str, StringConstraints(max_length=200)],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    path, info = await service.served_file(db, user.uuid, plugin_id, digest, file_path)
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": "attachment",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=31536000, immutable",
            "ETag": f'"{info["sha256"]}"',
        },
    )


@app_router.post("/{plugin_id}/proxy/{proxy_id}")
async def post_proxy_call(
    plugin_id: str,
    proxy_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    body = await _json_object(request, MAX_CALL_BODY)
    widget_id, args = body.get("widget"), body.get("args", {})
    if set(body) - {"widget", "args"} or not isinstance(widget_id, str) or not isinstance(args, dict):
        raise HTTPException(422, detail='The body is {"widget": "<widget id>", "args": {...}}')
    try:
        result = await calls.proxy_call(
            db,
            user.uuid,
            _checked(plugin_id, PLUGIN_ID_PATTERN, "plugin"),
            _checked(widget_id, WIDGET_ID_PATTERN, "widget"),
            _checked(proxy_id, PROXY_ID_PATTERN, "proxy"),
            args,
        )
    except CallError as error:
        raise HTTPException(error.status, detail={"code": error.code, "message": error.message}) from None
    return {"content_type": result.content_type, "body": result.body}


@app_router.post("/{plugin_id}/backend/{route_id}")
async def post_backend_call(
    plugin_id: str,
    route_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    body = await _json_object(request, MAX_CALL_BODY)
    widget_id, instance_id, args = body.get("widget"), body.get("instance", ""), body.get("args", {})
    if (
        set(body) - {"widget", "instance", "args"}
        or not isinstance(widget_id, str)
        or not isinstance(instance_id, str)
        or len(instance_id) > MAX_INSTANCE_ID
        or not isinstance(args, dict)
    ):
        raise HTTPException(422, detail='The body is {"widget": "<widget id>", "instance": "<id>", "args": {...}}')
    try:
        result = await calls.backend_call(
            db,
            user.uuid,
            _checked(plugin_id, PLUGIN_ID_PATTERN, "plugin"),
            _checked(widget_id, WIDGET_ID_PATTERN, "widget"),
            instance_id,
            _checked(route_id, PROXY_ID_PATTERN, "route"),
            args,
        )
    except CallError as error:
        raise HTTPException(error.status, detail={"code": error.code, "message": error.message}) from None
    return {"body": result.body}


@app_router.post("/report")
@limiter.limit(LIMIT_DEFAULT)
async def post_plugin_report(
    request: Request,
    body: ReportBody,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    stored = await service.record_reports(
        db, user.uuid, body.plugin_id, body.version, [r.model_dump() for r in body.reports], body.failure
    )
    return {"stored": stored}


@broker_router.post("/data/{data_source_id}")
async def post_broker_read(
    data_source_id: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
):
    token = request.headers.get(backends.CALL_HEADER, "")
    body = await _json_object(request, MAX_CALL_BODY)
    if set(body) - {"path", "method", "query", "body"} or not isinstance(body.get("path"), str):
        raise HTTPException(422, detail='The body is {"path": "/...", "method", "query", "body"}')
    try:
        return await broker.read(db, token, _checked(data_source_id, DATA_SOURCE_PATTERN, "data source"), body)
    except CallError as error:
        raise HTTPException(error.status, detail={"code": error.code, "message": error.message}) from None


routers = [platform_router, admin_router, app_router, broker_router]
