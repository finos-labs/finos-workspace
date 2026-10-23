import json
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit
from uuid import UUID

import httpx
from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import models
from routers.app.helpers import may_add_connections

from . import backends, metrics, service
from .proxy import CallError

MAX_BYTES = 5 * 1024 * 1024
TIMEOUT_SECONDS = 30.0
_METHODS = {"GET", "POST"}


async def readable_backend(db: AsyncSession, user_uuid: UUID, entity_uuid: UUID, backend_uuid: UUID):
    granted = (
        select(models.RoleBackend.backend_uuid)
        .join(models.UserRole, models.UserRole.role_uuid == models.RoleBackend.role_uuid)
        .join(models.Role, models.Role.uuid == models.RoleBackend.role_uuid)
        .where(
            models.UserRole.user_uuid == user_uuid,
            models.Role.entity_uuid == entity_uuid,
            models.Role.deleted_at.is_(None),
            models.RoleBackend.access == "access",
        )
    )
    rules = [models.ApiSource.entity_uuid == entity_uuid, models.ApiSource.uuid.in_(granted)]
    if await may_add_connections(db, user_uuid):
        rules.append(models.ApiSource.user_uuid == user_uuid)
    return (
        await db.execute(select(models.ApiSource).where(models.ApiSource.uuid == backend_uuid, or_(*rules)))
    ).scalar_one_or_none()


def _target(base: str, path: str, query: dict[str, str], credentials: list[dict]) -> tuple[str, dict[str, str]]:
    if (
        not path.startswith("/")
        or path.startswith("//")
        or "\\" in path
        or any(segment in {".", ".."} for segment in path.split("/"))
    ):
        raise CallError("invalid_args", "the path is one below the backend's own, starting with /")
    parts = urlsplit(base)
    headers: dict[str, str] = {}
    credential_query: dict[str, str] = {}
    for credential in credentials:
        if not isinstance(credential, dict) or not credential.get("key"):
            continue
        if credential.get("location") == "query":
            credential_query[str(credential["key"])] = str(credential.get("value", ""))
        else:
            headers[str(credential["key"])] = str(credential.get("value", ""))
    clashing = set(query) & set(credential_query)
    if clashing:
        raise CallError("invalid_args", f"{sorted(clashing)[0]} is set by the backend")
    full_query = urlencode({**credential_query, **query})
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/") + path, full_query, "")), headers


async def _send(method: str, url: str, headers: dict[str, str], body: Any) -> tuple[int, str, bytes]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
            outgoing = client.build_request(method, url, headers=headers, json=body if method == "POST" else None)
            response = await client.send(outgoing, stream=True)
            try:
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise CallError("response_too_large", "the backend's answer is too large", status=502)
                    chunks.append(chunk)
            finally:
                await response.aclose()
    except httpx.TimeoutException as error:
        raise CallError("timeout", "the data source did not answer in time", status=504) from error
    except httpx.HTTPError as error:
        raise CallError("upstream_unreachable", "the data source could not be reached", status=502) from error
    return response.status_code, response.headers.get("content-type", "").split(";")[0].strip().lower(), b"".join(chunks)


def _body(content_type: str, raw: bytes) -> Any:
    if content_type == "application/json":
        try:
            return json.loads(raw)
        except ValueError:
            pass
    return raw.decode("utf-8", errors="replace")


async def _resolve(db: AsyncSession, claims: dict[str, Any], data_source_id: str):
    if data_source_id not in claims.get("d", []):
        raise CallError("undeclared_data_source", f"the plugin does not declare {data_source_id}", status=403)
    user_uuid = UUID(claims["u"])
    entry = next(
        (e for e in await service.available(db, user_uuid) if e["plugin"].plugin_id == claims.get("p")),
        None,
    )
    if entry is None or entry["version"].version != claims.get("v"):
        raise CallError("not_available", "the plugin is not available to this user", status=403)
    mapped = (entry["entity_row"].data_sources or {}).get(data_source_id)
    if not mapped:
        raise CallError("data_source_unmapped", f"the organization serves no backend as {data_source_id}", 409)
    source = await readable_backend(db, user_uuid, entry["entity_row"].entity_uuid, UUID(mapped))
    if source is None:
        raise CallError("not_permitted", "the user may not read this data source", status=403)
    return entry, source


async def read(db: AsyncSession, token: str, data_source_id: str, request: dict[str, Any]) -> dict[str, Any]:
    claims = backends.read_token(token)
    plugin_id = str(claims.get("p", ""))
    outcome = "ok"
    try:
        _entry, source = await _resolve(db, claims, data_source_id)
        method = str(request.get("method", "GET")).upper()
        query = request.get("query") or {}
        if method not in _METHODS or not isinstance(query, dict):
            raise CallError("invalid_args", "method is GET or POST, and query an object")
        url, headers = _target(
            str(source.url),
            str(request.get("path", "")),
            {str(k): str(v) for k, v in query.items()},
            list(source.endpointHeaders or []),
        )
        status, content_type, raw = await _send(method, url, headers, request.get("body"))
        return {"status": status, "content_type": content_type, "body": _body(content_type, raw)}
    except CallError as error:
        outcome = error.code
        raise
    finally:
        metrics.BROKER_CALLS.labels(plugin_id, outcome).inc()
        logger.info(f"widget plugin broker plugin={plugin_id} data_source={data_source_id} outcome={outcome}")
