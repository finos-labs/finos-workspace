import re
import time
from collections.abc import Iterator
from typing import Any
from urllib.parse import SplitResult, unquote, urlsplit
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import models, source_proxy

META_FILES = ("widgets.json", "apps.json", "templates.json", "agents.json")
APP_FILES = ("apps.json", "templates.json")
IMAGE_KEYS = ("img", "img_dark", "img_light")
TABLE_SECONDS = 60.0
TABLE_ENTRIES = 1024
PLACEHOLDER = re.compile(r"\{[^{}]+\}")
SLASHES = re.compile(r"/{2,}")

Pattern = tuple[tuple[str, ...], ...]

_tables: dict[tuple[str, str], tuple[float, "Routes"]] = {}


def _trimmed(parts: list[str]) -> list[str]:
    if parts and not parts[0]:
        parts = parts[1:]
    if parts and not parts[-1]:
        parts = parts[:-1]
    return parts


def segments_of(path: str) -> list[str] | None:
    segments = []
    for part in _trimmed(path.split("/")):
        text = unquote(part)
        if not part or "\\" in part or "\0" in text or any(piece in {".", ".."} for piece in text.split("/")):
            return None
        segments.append(text)
    return segments


def pattern_of(path: str) -> Pattern | None:
    pattern = []
    for part in _trimmed(path.split("/")):
        literals = tuple(unquote(literal) for literal in PLACEHOLDER.split(part))
        if len(literals) == 1 and literals[0] in {"", ".", ".."}:
            return None
        pattern.append(literals)
    return tuple(pattern)


def fits(literals: tuple[str, ...], segment: str) -> bool:
    first, *rest = literals
    if not rest:
        return segment == first
    last = rest[-1]
    if not (segment.startswith(first) and segment.endswith(last)):
        return False
    position = len(first)
    end = len(segment) - len(last)
    for literal in rest[:-1]:
        position += 1
        found = segment.find(literal, position, end)
        if found < 0:
            return False
        position = found + len(literal)
    return end - position >= 1


class Routes:
    def __init__(self) -> None:
        self._held: dict[tuple[str, Pattern], set[str | None]] = {}
        self._index: dict[tuple[str, int], list[tuple[Pattern, frozenset[str | None]]]] = {}

    def add(self, method: str, path: str, widget_id: str | None) -> None:
        if (pattern := pattern_of(path)) is not None:
            self._held.setdefault((method, pattern), set()).add(widget_id)

    def freeze(self) -> "Routes":
        for (method, pattern), widget_ids in self._held.items():
            self._index.setdefault((method, len(pattern)), []).append((pattern, frozenset(widget_ids)))
        return self

    def match(self, method: str, segments: list[str]) -> list[frozenset[str | None]]:
        return [
            widget_ids
            for pattern, widget_ids in self._index.get((method, len(segments)), ())
            if all(fits(literals, segment) for literals, segment in zip(pattern, segments, strict=True))
        ]


def _method(value: object, default: str) -> str:
    return value.upper() if isinstance(value, str) and value else default


def _params(params: object) -> Iterator[Any]:
    for item in params if isinstance(params, list) else []:
        yield from item if isinstance(item, list) else [item]


def _declared(widget: dict) -> Iterator[tuple[str, object]]:
    yield _method(widget.get("method"), "GET"), widget.get("endpoint")
    if isinstance(widget.get("data"), dict):
        yield "GET", widget["data"].get("streamEndpoint")
    for param in _params(widget.get("params")):
        if not isinstance(param, dict):
            continue
        if param.get("type") == "endpoint":
            yield _method(param.get("optionsMethod"), "GET"), param.get("optionsEndpoint")
        elif param.get("type") == "form":
            yield _method(param.get("method"), "POST"), param.get("endpoint")
            for inner in _params(param.get("inputParams")):
                if isinstance(inner, dict) and inner.get("type") == "endpoint":
                    yield _method(inner.get("optionsMethod"), "GET"), inner.get("optionsEndpoint")


def _path_of(endpoint: object, base: SplitResult) -> str | None:
    if not isinstance(endpoint, str):
        return None
    endpoint = endpoint.strip().split("?", 1)[0].split("#", 1)[0]
    if not endpoint or endpoint.startswith("data:"):
        return None
    if not endpoint.startswith("http"):
        return SLASHES.sub("/", f"{base.path.rstrip('/')}/{endpoint}")
    try:
        return SLASHES.sub("/", urlsplit(endpoint).path) if source_proxy.on_origin(base.geturl(), endpoint) else None
    except ValueError:
        return None


def _images(apps: object) -> Iterator[str]:
    for item in apps if isinstance(apps, list) else [apps]:
        if isinstance(item, dict):
            for key in IMAGE_KEYS:
                if isinstance(item.get(key), str):
                    yield item[key]


def routes_of(widgets: object, apps: object, base_url: str) -> Routes:
    base = urlsplit(base_url)
    routes = Routes()
    for name in META_FILES:
        routes.add("GET", f"{base.path.rstrip('/')}/{name}", None)
    for image in _images(apps):
        if (path := _path_of(image, base)) is not None:
            routes.add("GET", path, None)
    for widget_id, widget in widgets.items() if isinstance(widgets, dict) else []:
        if not isinstance(widget, dict) or widget_id.startswith("$"):
            continue
        for method, endpoint in _declared(widget):
            if (path := _path_of(endpoint, base)) is not None:
                routes.add(method, path, widget_id)
    return routes.freeze()


def check(routes: Routes, granted: frozenset[str], method: str, url: str) -> None:
    segments = segments_of(urlsplit(url).path)
    groups = routes.match(method.upper(), segments) if segments is not None else []
    if not groups:
        raise source_proxy.refused("the connection's widgets.json declares no route like this one", 403)
    for widget_ids in groups:
        if None not in widget_ids and not widget_ids & granted:
            raise source_proxy.refused("none of your roles gives you the widget that this route belongs to", 403)


async def granted_widgets(
    db: AsyncSession, user_uuid: UUID, entity_uuid: UUID | None, source
) -> frozenset[str] | None:
    if source.user_uuid == user_uuid:
        return None
    rows = (
        (
            await db.execute(
                select(models.RoleBackend.widgets)
                .join(models.UserRole, models.UserRole.role_uuid == models.RoleBackend.role_uuid)
                .join(models.Role, models.Role.uuid == models.RoleBackend.role_uuid)
                .where(
                    models.UserRole.user_uuid == user_uuid,
                    models.Role.entity_uuid == entity_uuid,
                    models.Role.deleted_at.is_(None),
                    models.RoleBackend.backend_uuid == source.uuid,
                    models.RoleBackend.access == "access",
                )
            )
        )
        .scalars()
        .all()
    )
    return frozenset(
        widget["widgetId"]
        for widgets in rows
        for widget in widgets or []
        if isinstance(widget, dict) and widget.get("access") == "access" and isinstance(widget.get("widgetId"), str)
    )


async def _apps(source, email: str, trusted: bool, identity) -> object:
    for name in APP_FILES:
        try:
            return await source_proxy.fetch_json(source, email, trusted, identity, name)
        except HTTPException:
            continue
    return None


async def routes_for(source, email: str, trusted: bool, identity) -> Routes:
    key = (str(source.uuid), email)
    held = _tables.get(key)
    if held and time.monotonic() - held[0] < TABLE_SECONDS:
        return held[1]
    widgets = await source_proxy.fetch_json(source, email, trusted, identity)
    routes = routes_of(widgets, await _apps(source, email, trusted, identity), str(source.url))
    source_proxy.remember(_tables, TABLE_ENTRIES, key, (time.monotonic(), routes))
    return routes


async def require(source, email: str, trusted: bool, identity, granted: frozenset[str], method: str, url: str) -> None:
    check(await routes_for(source, email, trusted, identity), granted, method, url)
