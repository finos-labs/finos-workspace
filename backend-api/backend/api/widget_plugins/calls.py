"""A widget's calls to the server side of its plugin (docs/widget-plugins/SERVER-SIDE.md
3.3 and 5): a declared proxy, or a route of the plugin's backend.

Every call is authorized like any API call: the plugin available to the user, the
effective permission, and the proxy or route named by the widget. A revoked plugin is
not available, so revoking stops its calls at once. Calls are capped in size, time,
concurrency and rate, and logged with the plugin, widget, proxy or route, outcome,
duration and size: never arguments, bodies or secrets.
"""

import contextlib
import json
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from limits import parse
from loguru import logger
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.rate_limit import limiter
from utilities.config import settings

from . import (
    backends,
    metrics,
    proxy as proxy_rules,
    secrets as secret_values,
    service,
)
from .manifest import Backend, Route
from .proxy import CallError, Proxy, ProxyResult

PROXY_PERMISSION = "core:proxy:call"
BACKEND_PERMISSION = "core:backend:call"

# Calls running now, per plugin and kind, in this process
_running: dict[str, int] = {}


@contextlib.asynccontextmanager
async def _slot(key: str, cap: int) -> AsyncIterator[None]:
    if _running.get(key, 0) >= cap:
        raise CallError("busy", "too many calls of this plugin are running; try again shortly", status=429)
    _running[key] = _running.get(key, 0) + 1
    try:
        yield
    finally:
        _running[key] -= 1


def _count(kind: str, user_uuid: UUID, plugin_id: str, per_user: str, per_plugin: str) -> None:
    """The per-user and the per-plugin rate limits, in the API's rate limit storage."""
    for rate, keys in ((per_user, (plugin_id, str(user_uuid))), (per_plugin, (plugin_id,))):
        if not limiter.limiter.hit(parse(rate), f"widget-plugin-{kind}", *keys):
            raise CallError("rate_limited", "too many calls; try again shortly", status=429)


async def _widget(db: AsyncSession, user_uuid: UUID, plugin_id: str, widget_id: str, permission: str):
    """The available plugin entry and the widget, which has the permission."""
    entry = next((e for e in await service.available(db, user_uuid) if e["plugin"].plugin_id == plugin_id), None)
    widget = next((w for w in entry["widgets"] if w["id"] == widget_id), None) if entry else None
    if entry is None or widget is None:
        raise CallError("not_available", "this plugin widget is not available to you", status=404)
    if permission not in widget["permissions"]:
        raise CallError("permission_denied", f"the widget does not have {permission}", status=403)
    return entry, widget


def _server(entry: dict) -> dict:
    return (entry["version"].manifest or {}).get("server") or {}


# ---------------------------------------------------------------------------
# Proxies (SERVER-SIDE 3)
# ---------------------------------------------------------------------------


async def _proxy_target(db: AsyncSession, user_uuid: UUID, plugin_id: str, widget_id: str, proxy_id: str):
    entry, widget = await _widget(db, user_uuid, plugin_id, widget_id, PROXY_PERMISSION)
    if proxy_id not in ((widget.get("server") or {}).get("proxies") or []):
        raise CallError("unknown_proxy", f"the widget does not declare the proxy {proxy_id}", status=403)
    declared = next((p for p in _server(entry).get("proxies", []) if p["id"] == proxy_id), None)
    try:
        template = Proxy.model_validate(declared)
    except ValidationError as error:
        raise CallError("unknown_proxy", f"the plugin does not declare the proxy {proxy_id}", status=403) from error
    return entry, template


async def proxy_call(
    db: AsyncSession, user_uuid: UUID, plugin_id: str, widget_id: str, proxy_id: str, args: dict[str, Any]
) -> ProxyResult:
    """Authorize, limit, make, count and log one proxy call."""
    started = time.monotonic()
    outcome, size, upstream, available = "ok", 0, None, False
    try:
        entry, template = await _proxy_target(db, user_uuid, plugin_id, widget_id, proxy_id)
        available = True
        _count(
            "proxy",
            user_uuid,
            plugin_id,
            settings.WIDGET_PLUGIN_PROXY_RATE_PER_USER,
            settings.WIDGET_PLUGIN_PROXY_RATE_PER_PLUGIN,
        )
        names = {
            name
            for value in template.headers.values()
            for kind, name in proxy_rules.TOKEN.findall(value)
            if kind == "secret"
        }
        secrets = await secret_values.resolve(db, entry["plugin"], names)
        async with _slot(f"proxy:{plugin_id}", settings.WIDGET_PLUGIN_PROXY_CONCURRENCY):
            result = await proxy_rules.call(
                template,
                args,
                secrets,
                network=entry["network"],
                allow_private=entry["private"],
                max_bytes=settings.WIDGET_PLUGIN_PROXY_MAX_BYTES,
                timeout_ms=settings.WIDGET_PLUGIN_PROXY_TIMEOUT_MS,
                ca_file=settings.WIDGET_PLUGIN_PROXY_CA_FILE,
            )
        size, upstream = result.size, result.status
        return result
    except CallError as error:
        outcome, upstream = error.code, error.upstream
        raise
    except Exception as error:
        # An error's text can carry a URL with arguments; only its type is logged
        outcome = "failed"
        logger.error(f"widget plugin proxy {plugin_id}/{proxy_id} failed with {type(error).__name__}")
        raise CallError("upstream_error", "the call failed", status=502) from None
    finally:
        seconds = time.monotonic() - started
        # Counted for plugins the user may use, so the label is a plugin of the deployment
        if available:
            metrics.PROXY_CALLS.labels(plugin_id, outcome, metrics.status_class(upstream)).inc()
            metrics.PROXY_SECONDS.labels(plugin_id).observe(seconds)
        logger.info(
            f"widget plugin proxy plugin={plugin_id} widget={widget_id} proxy={proxy_id} outcome={outcome} "
            f"bytes={size} duration_ms={int(seconds * 1000)}"
        )


# ---------------------------------------------------------------------------
# Backend routes (SERVER-SIDE 5)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BackendResult:
    body: Any
    status: int
    size: int


async def _route_target(db: AsyncSession, user_uuid: UUID, plugin_id: str, widget_id: str, route_id: str):
    entry, widget = await _widget(db, user_uuid, plugin_id, widget_id, BACKEND_PERMISSION)
    if route_id not in ((widget.get("server") or {}).get("routes") or []):
        raise CallError("unknown_route", f"the widget does not declare the route {route_id}", status=403)
    try:
        backend = Backend.model_validate(_server(entry).get("backend"))
    except ValidationError as error:
        raise CallError("unknown_route", "the plugin declares no backend", status=403) from error
    route = next((r for r in backend.routes if r.id == route_id), None)
    if route is None:
        raise CallError("unknown_route", f"the backend has no route {route_id}", status=403)
    return entry, route


async def backend_ready(db: AsyncSession, entry: dict, *, force: bool = False) -> backends.Identity:
    """The backend's identity, checked against the active version (SERVER-SIDE 5.5). A
    mismatch stops routing, and its start is recorded."""
    plugin, version = entry["plugin"], entry["version"]
    identity = await backends.check_identity(plugin.plugin_id, version.version, version.digest, force=force)
    metrics.BACKEND_IDENTITY.labels(plugin.plugin_id, identity.state).inc()
    if identity.state == backends.IDENTITY_MISMATCH and identity.changed:
        await service.record_event(
            db,
            plugin,
            "backend-mismatch",
            version=version.version,
            details={"detail": identity.detail, "digest": identity.digest},
        )
    return identity


def _headers(token: str, route: Route, secrets: dict[str, str]) -> dict[str, str]:
    """The call's token and the secrets the route declares. A secret name's underscores
    become hyphens, which every proxy in between passes through."""
    missing = [name for name in route.secrets if name not in secrets]
    if missing:
        raise CallError("secret_missing", f"the secret {missing[0]} is not set", status=409)
    headers = {backends.CALL_HEADER: token}
    for name in route.secrets:
        headers[backends.SECRET_HEADER + name.replace("_", "-")] = secrets[name]
    return headers


def _context(entry: dict, user_uuid: UUID, widget_id: str, instance_id: str) -> tuple[str, dict[str, str]]:
    """The call-context token the backend shows the broker, and what the backend learns
    of the caller: a pseudonymous id when the admin approved one, otherwise nothing."""
    plugin, version = entry["plugin"], entry["version"]
    token = backends.mint_token(
        {
            "p": plugin.plugin_id,
            "v": version.version,
            "w": widget_id,
            "i": instance_id,
            "u": str(user_uuid),
            "e": str(entry["entity_row"].entity_uuid),
            "d": [d["id"] for d in (version.manifest or {}).get("dataSources", [])],
        }
    )
    pseudonymous = (version.approved or {}).get("identity") == "pseudonymous"
    caller = {"id": backends.pseudonym(plugin.plugin_id, str(user_uuid))} if pseudonymous else {}
    return token, caller


def _decode(status: int, content_type: str, raw: bytes) -> Any:
    if not 200 <= status < 300:  # noqa: PLR2004
        # A refusal of the backend's own is not a failure of the backend
        code = "backend_error" if status >= 500 else "backend_refused"  # noqa: PLR2004
        raise CallError(code, f"the backend answered {status // 100}xx", 502, status)
    if content_type != "application/json":
        raise CallError("unsupported_content_type", f"the backend answered {content_type or 'no type'}", 502, status)
    try:
        return json.loads(raw)
    except ValueError as error:
        raise CallError("backend_error", "the backend's answer is not JSON", 502, status) from error


async def _send_route(  # noqa: PLR0913 - the call's parts
    db: AsyncSession, entry: dict, route: Route, user_uuid: UUID, widget_id: str, instance_id: str, args: dict
) -> BackendResult:
    plugin = entry["plugin"]
    plugin_id = plugin.plugin_id
    url = backends.registered_url(plugin_id)
    if url is None:
        raise CallError("backend_unregistered", "the deployment runs no backend for this plugin", status=503)
    identity = await backend_ready(db, entry)
    if identity.state != backends.IDENTITY_OK:
        raise CallError(f"backend_{identity.state}", f"the backend cannot be used: {identity.detail}", status=503)
    if backends.breaker_open(plugin_id):
        raise CallError("backend_unavailable", "the backend is failing; try again shortly", status=503)
    checked = proxy_rules.check_args(route.args, args)
    secrets = await secret_values.resolve(db, plugin, route.secrets)
    token, caller = _context(entry, user_uuid, widget_id, instance_id)
    headers = _headers(token, route, secrets)
    async with _slot(f"backend:{plugin_id}", settings.WIDGET_PLUGIN_BACKEND_CONCURRENCY):
        with backends.outcome(plugin_id):
            status, content_type, raw = await backends.request(
                url,
                "POST",
                f"/.workspace/routes/{route.id}",
                json_body={"args": checked, "widget": {"id": widget_id, "instanceId": instance_id}, "caller": caller},
                headers=headers,
                timeout=min(route.response.timeoutMs, settings.WIDGET_PLUGIN_BACKEND_TIMEOUT_MS) / 1000,
                limit=min(route.response.maxBytes, settings.WIDGET_PLUGIN_BACKEND_MAX_BYTES),
            )
            body = _decode(status, content_type, raw)
    return BackendResult(body=body, status=status, size=len(raw))


async def backend_call(  # noqa: PLR0913 - who calls what, with what
    db: AsyncSession,
    user_uuid: UUID,
    plugin_id: str,
    widget_id: str,
    instance_id: str,
    route_id: str,
    args: dict[str, Any],
) -> BackendResult:
    """Authorize, limit, make, count and log one call to a backend route."""
    started = time.monotonic()
    outcome, size, status, available = "ok", 0, None, False
    try:
        entry, route = await _route_target(db, user_uuid, plugin_id, widget_id, route_id)
        available = True
        _count(
            "backend",
            user_uuid,
            plugin_id,
            settings.WIDGET_PLUGIN_BACKEND_RATE_PER_USER,
            settings.WIDGET_PLUGIN_BACKEND_RATE_PER_PLUGIN,
        )
        result = await _send_route(db, entry, route, user_uuid, widget_id, instance_id, args)
        size, status = result.size, result.status
        return result
    except CallError as error:
        outcome, status = error.code, error.upstream
        raise
    except Exception as error:
        outcome = "failed"
        logger.error(f"widget plugin backend {plugin_id}/{route_id} failed with {type(error).__name__}")
        raise CallError("backend_error", "the call failed", status=502) from None
    finally:
        seconds = time.monotonic() - started
        if available:
            metrics.BACKEND_CALLS.labels(plugin_id, outcome, metrics.status_class(status)).inc()
            metrics.BACKEND_SECONDS.labels(plugin_id).observe(seconds)
        logger.info(
            f"widget plugin backend plugin={plugin_id} widget={widget_id} route={route_id} outcome={outcome} "
            f"bytes={size} duration_ms={int(seconds * 1000)}"
        )


async def check_backend(db: AsyncSession, plugin_id: str) -> dict[str, Any]:
    """A superuser's check of a plugin's backend: its identity against the active
    version, asked now, and what the admin page shows."""
    plugin, version = await service.plugin_and_active_version(db, plugin_id)
    if version is None:
        raise CallError("not_approved", "no version of this plugin is active", status=409)
    if backends.registered_url(plugin_id) is not None:
        await backend_ready(db, {"plugin": plugin, "version": version}, force=True)
    return service.backend_status(plugin)
