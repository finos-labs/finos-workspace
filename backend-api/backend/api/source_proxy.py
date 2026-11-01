import asyncio
import json
import re
import socket
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from http import HTTPStatus
from types import SimpleNamespace
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from uuid import UUID

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from limits import parse
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, models
from api.widget_plugins.service import local_development
from api.widget_plugins.widgets_schema import load_kit
from utilities.egress import EgressRefused, check_destination, pinned_request

MAX_STREAM_BYTES = 256 * 1024 * 1024
STREAM_MAX_SECONDS = 3600.0
MAX_OPEN_PER_USER = 128
MAX_OPEN_PER_PROCESS = 2000
MAX_JSON_BYTES = 5 * 1024 * 1024
JSON_CACHE_SECONDS = 60.0
JSON_CACHE_ENTRIES = 1024
DECISION_SECONDS = 30.0
DECISION_ENTRIES = 4096
MAX_AWAITING_PER_ORIGIN = 512
BREAKER_FAILURES = 5
BREAKER_SECONDS = 10.0
BREAKER_ENTRIES = 4096
BODY_BUDGET_BYTES = 256 * 1024 * 1024
AGENT_WAITS = (120.0, 600.0)
AGENT_EXPOSED_HEADERS = "X-Trace-Id, X-Completion-Id"
REQUESTS_PER_MINUTE = parse("1200/minute")
FRAME_REQUESTS_PER_MINUTE = parse("6000/minute")
GRANTS_PER_MINUTE = parse("120/minute")
SOCKETS_PER_MINUTE = parse("120/minute")
MCP_REQUESTS_PER_MINUTE = parse("1200/minute")
AGENT_REQUESTS_PER_MINUTE = parse("1200/minute")
LIMITER_SECONDS = 1.0
LIMITER_BACKOFF_SECONDS = 30.0
CONNECT_SECONDS = 10.0
HEADERS_SECONDS = 50.0
IDLE_SECONDS = 120.0
WRITE_SECONDS = 30.0
POOL_SECONDS = 10.0
MAX_CONNECTIONS = 2000
MAX_KEEPALIVE = 200
KEEPALIVE_SECONDS = 30.0
RETRY_AFTER_SECONDS = "5"
USER_HEADER = "X-Workspace-User"
METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
NOT_PASSED_BACK = {
    "connection",
    "content-length",
    "date",
    "server",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "set-cookie",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}
REDIRECTS = {301, 302, 303, 307, 308}
MAX_REDIRECTS = 5
SANDBOX = "sandbox; default-src 'none'"
FRAME_SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-downloads"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
HOST_MACHINE = "host.docker.internal"
RATE_SCRIPT = (
    "local used = redis.call('INCR', KEYS[1]) "
    "if used == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end "
    "return used"
)
SSL_CONTEXT = httpx.create_ssl_context()

_open_streams: dict[UUID, int] = {}
_open_total = 0
_limiter_down_until = 0.0
_clients: dict[str, object] = {}
_awaiting: dict[str, int] = {}
_breakers: dict[str, tuple[int, float]] = {}
_host_machine: dict[str, bool] = {}
_buffered: dict[str, int] = {"bytes": 0}


def _rules() -> tuple[re.Pattern, set[str], tuple[str, ...], re.Pattern]:
    headers = load_kit()["headers"]
    return (
        re.compile(headers["namePattern"]),
        {name.lower() for name in [*headers["forbidden"], *headers["reserved"]]},
        tuple(headers["forbiddenPrefixes"]),
        re.compile(headers["valuePattern"]),
    )


def refused(detail: str, status: int = 400) -> HTTPException:
    headers = {"X-Workspace-Proxy-Error": "1"}
    if status in {429, 503}:
        headers["Retry-After"] = RETRY_AFTER_SECONDS
    return HTTPException(status, detail=detail, headers=headers)


def _credentials(rows: list[dict] | None) -> tuple[dict[str, str], dict[str, str]]:
    headers: dict[str, str] = {}
    query: dict[str, str] = {}
    for row in rows or []:
        if not isinstance(row, dict) or not row.get("key"):
            continue
        target = query if row.get("location") == "query" else headers
        target[str(row["key"])] = str(row.get("value", ""))
    return headers, query


def keep_stored_values(stored: list[dict] | None, incoming: list[dict] | None) -> list[dict]:
    kept = {(row.get("key"), row.get("location", "headers")): row.get("value", "") for row in stored or []}
    return [
        {
            **row,
            "value": row["value"]
            if row.get("value", "")
            else kept.get((row["key"], row.get("location", "headers")), ""),
        }
        for row in incoming or []
    ]


def _same_origin(base, parts) -> bool:
    return (
        parts.scheme == base.scheme
        and (parts.hostname or "").lower() == (base.hostname or "").lower()
        and (parts.port or 0) == (base.port or 0)
    )


def on_origin(first: str, second: str) -> bool:
    return _same_origin(urlsplit(first), urlsplit(second))


def target_of(
    source: models.ApiSource,
    url: str,
    extra_headers: dict[str, str],
    email: str,
    identity: Mapping[str, str],
) -> tuple[str, dict[str, str]]:
    base = urlsplit(str(source.url))
    parts = urlsplit(url)
    path = parts.path or "/"
    if parts.username is not None or parts.password is not None or not _same_origin(base, parts):
        raise refused("the URL is not on the connection's own origin", 403)

    credential_headers, credential_query = _credentials(source.endpointHeaders)
    query = parse_qsl(parts.query, keep_blank_values=True)
    if {key for key, _ in query} & set(credential_query):
        raise refused("a query value is set by the data connection")

    name_pattern, forbidden, prefixes, value_pattern = _rules()
    taken = {name.lower() for name in credential_headers}
    headers: dict[str, str] = {}
    for name, value in extra_headers.items():
        lower = name.lower()
        if (
            not name_pattern.match(name)
            or lower in forbidden
            or lower.startswith(prefixes)
            or lower in taken
            or not value_pattern.match(value)
        ):
            raise refused(f"{name} cannot be sent as a header")
        headers[name] = value
    headers.update(credential_headers)
    platform = {USER_HEADER: email, **identity}
    headers = {
        name: value for name, value in headers.items() if name.lower() not in map(str.lower, platform)
    } | platform
    if "accept-encoding" not in {name.lower() for name in headers}:
        headers["Accept-Encoding"] = "identity"
    full = urlencode([*credential_query.items(), *query])
    return urlunsplit((parts.scheme, parts.netloc, path, full, "")), headers


async def _hit(limit, bucket: str, user_uuid: UUID) -> bool:
    key = auth_helpers.app_redis_key(f"proxy-rate:{bucket}:{user_uuid}")
    async with auth_helpers.app_redis() as redis:
        used = await redis.eval(RATE_SCRIPT, 1, key, limit.get_expiry())
    return used <= limit.amount


async def count(user_uuid: UUID, bucket: str = "data-connection-request", limit=REQUESTS_PER_MINUTE) -> None:
    global _limiter_down_until  # noqa: PLW0603
    loop = asyncio.get_running_loop()
    if loop.time() < _limiter_down_until:
        return
    try:
        allowed = await asyncio.wait_for(_hit(limit, bucket, user_uuid), LIMITER_SECONDS)
    except Exception as error:  # noqa: BLE001
        _limiter_down_until = loop.time() + LIMITER_BACKOFF_SECONDS
        logger.warning(f"the rate limiter is unavailable, requests are not counted for a while: {type(error).__name__}")
        return
    if not allowed:
        raise refused("too many requests; try again shortly", 429)


def acquire(user_uuid: UUID) -> None:
    global _open_total  # noqa: PLW0603
    if _open_total >= MAX_OPEN_PER_PROCESS:
        raise refused("the server is busy; try again shortly", 503)
    if _open_streams.get(user_uuid, 0) >= MAX_OPEN_PER_USER:
        raise refused("too many requests are open at once", 429)
    _open_streams[user_uuid] = _open_streams.get(user_uuid, 0) + 1
    _open_total += 1


def release(user_uuid: UUID) -> None:
    global _open_total  # noqa: PLW0603
    _open_total -= 1
    _open_streams[user_uuid] -= 1
    if not _open_streams[user_uuid]:
        del _open_streams[user_uuid]


def _timeout() -> httpx.Timeout:
    return httpx.Timeout(IDLE_SECONDS, connect=CONNECT_SECONDS, write=WRITE_SECONDS, pool=POOL_SECONDS)


def _shared_client() -> httpx.AsyncClient:
    loop = asyncio.get_running_loop()
    held = _clients.get("shared")
    if held is None or held[0] is not loop or held[1].is_closed:
        _clients["shared"] = (
            loop,
            httpx.AsyncClient(
                verify=SSL_CONTEXT,
                follow_redirects=False,
                timeout=_timeout(),
                limits=httpx.Limits(
                    max_connections=MAX_CONNECTIONS,
                    max_keepalive_connections=MAX_KEEPALIVE,
                    keepalive_expiry=KEEPALIVE_SECONDS,
                ),
            ),
        )
    return _clients["shared"][1]


def _pinned_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        verify=SSL_CONTEXT,
        follow_redirects=False,
        timeout=_timeout(),
        limits=httpx.Limits(max_keepalive_connections=0),
    )


class Relayed(StreamingResponse):
    def __init__(
        self,
        response: httpx.Response,
        client: httpx.AsyncClient | None,
        user_uuid: UUID,
        limit: int | None,
        watch: Callable[[AsyncIterator[bytes]], AsyncIterator[bytes]] | None = None,
        seconds: float | None = STREAM_MAX_SECONDS,
        **kwargs,
    ):
        self._upstream = response
        self._client = client
        self._user = user_uuid
        self._closed = False
        self._limit = limit
        self._seconds = seconds
        super().__init__(watch(self._body()) if watch else self._body(), **kwargs)

    async def _body(self):
        size = 0
        async with asyncio.timeout(self._seconds):
            async for chunk in self._upstream.aiter_raw():
                size += len(chunk)
                if self._limit is not None and size > self._limit:
                    logger.warning("a data connection answered more than the limit; the response was cut")
                    raise RuntimeError("the data connection's answer is over the limit")
                yield chunk

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            await self._upstream.aclose()
        finally:
            try:
                if self._client is not None:
                    await self._client.aclose()
            finally:
                release(self._user)

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            await asyncio.shield(self.close())


async def _host_machine_resolves() -> bool:
    if HOST_MACHINE not in _host_machine:
        try:
            await asyncio.get_running_loop().getaddrinfo(HOST_MACHINE, None)
        except socket.gaierror:
            _host_machine[HOST_MACHINE] = False
        else:
            _host_machine[HOST_MACHINE] = True
    return _host_machine[HOST_MACHINE]


async def reach_host_machine(url: str) -> tuple[str, str | None]:
    parts = urlsplit(url)
    if parts.hostname not in LOOPBACK_HOSTS or not await _host_machine_resolves():
        return url, None
    port = f":{parts.port}" if parts.port else ""
    return urlunsplit(parts._replace(netloc=f"{HOST_MACHINE}{port}")), parts.netloc


def snapshot(source) -> SimpleNamespace:
    return SimpleNamespace(
        uuid=source.uuid,
        url=source.url,
        endpointHeaders=source.endpointHeaders,
        entity_uuid=source.entity_uuid,
        user_uuid=source.user_uuid,
    )


async def owned_by_superuser(db: AsyncSession, source) -> bool:
    if source.entity_uuid is not None:
        return True
    owner = source.user_uuid
    if owner is None:
        return False
    return bool(
        (await db.execute(select(models.User.is_superuser).where(models.User.uuid == owner))).scalar_one_or_none()
    )


def remember(cache: dict, limit: int, key, value) -> None:
    if len(cache) >= limit and key not in cache:
        del cache[next(iter(cache))]
    cache[key] = value


_decisions: dict[tuple[UUID, UUID], tuple[float, bool]] = {}


def decided(user_uuid: UUID, source_uuid: UUID) -> bool | None:
    held = _decisions.get((user_uuid, source_uuid))
    if held and time.monotonic() - held[0] < DECISION_SECONDS:
        return held[1]
    return None


def decide(user_uuid: UUID, source_uuid: UUID, trusted: bool) -> None:
    remember(_decisions, DECISION_ENTRIES, (user_uuid, source_uuid), (time.monotonic(), trusted))


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{(parts.hostname or '').lower()}:{parts.port or 0}"


def breaker_open(origin: str) -> bool:
    failures, until = _breakers.get(origin, (0, 0.0))
    if failures < BREAKER_FAILURES:
        return False
    now = time.monotonic()
    if now < until:
        return True
    _breakers[origin] = (failures, now + BREAKER_SECONDS)
    return False


def failed(origin: str) -> None:
    failures = _breakers.get(origin, (0, 0.0))[0] + 1
    remember(_breakers, BREAKER_ENTRIES, origin, (failures, time.monotonic() + BREAKER_SECONDS))


def answered(origin: str) -> None:
    _breakers.pop(origin, None)


def admit(origin: str) -> None:
    if breaker_open(origin):
        raise refused("the data connection is not answering; try again shortly", 503)
    if _awaiting.get(origin, 0) >= MAX_AWAITING_PER_ORIGIN:
        raise refused("the data connection is answering slowly and has too many requests waiting; try again shortly", 503)
    _awaiting[origin] = _awaiting.get(origin, 0) + 1


def left(origin: str) -> None:
    _awaiting[origin] -= 1
    if not _awaiting[origin]:
        del _awaiting[origin]


def _has(headers: dict[str, str], name: str) -> bool:
    return name.lower() in {key.lower() for key in headers}


def _request_timeout(idle: float) -> dict[str, float]:
    return {"connect": CONNECT_SECONDS, "read": idle, "write": WRITE_SECONDS, "pool": POOL_SECONDS}


async def _prepare(
    method: str, url: str, headers: dict[str, str], content: bytes | None, trusted: bool, idle: float
) -> tuple[httpx.Request, httpx.AsyncClient, bool]:
    timeout = _request_timeout(idle)
    if not (trusted or local_development()):
        try:
            destination = await check_destination(url, allow_private=False)
        except EgressRefused as error:
            message = f"a connection kept by a user who is not a superuser must be a public https address: {error}"
            raise refused(message, 403) from error
        request = pinned_request(method, url, destination, headers=headers, content=content, timeout=timeout)
        return request, _pinned_client(), True
    target, host_header = await reach_host_machine(url) if local_development() else (url, None)
    request_headers = {**headers, "Host": host_header} if host_header else headers
    request = httpx.Request(method, target, headers=request_headers, content=content, extensions={"timeout": timeout})
    return request, _shared_client(), False


async def _open(
    method: str, url: str, headers: dict[str, str], content: bytes | None, trusted: bool, idle: float | None = None
) -> tuple[httpx.Response, httpx.AsyncClient | None]:
    origin = urlsplit(url)
    current_method, current_url = method, url
    request_headers = headers
    for hop in range(MAX_REDIRECTS + 1):
        request, client, owned = await _prepare(
            current_method, current_url, request_headers, content, trusted, IDLE_SECONDS if idle is None else idle
        )
        response = None
        try:
            response = await client.send(request, stream=True)
            location = response.headers.get("location")
            final = response.status_code not in REDIRECTS or not location or hop == MAX_REDIRECTS
            following = None if final else urljoin(current_url, location)
            if following is not None:
                parts = urlsplit(following)
                final = parts.username is not None or parts.password is not None or not _same_origin(origin, parts)
            if final:
                return response, (client if owned else None)
            await response.aclose()
        except BaseException:
            if response is not None:
                await asyncio.shield(response.aclose())
            if owned:
                await asyncio.shield(client.aclose())
            raise
        if owned:
            await client.aclose()
        if response.status_code == HTTPStatus.SEE_OTHER and current_method != "HEAD":
            current_method = "GET"
            content = None
            request_headers = {k: v for k, v in request_headers.items() if k.lower() != "content-type"}
        current_url = following
    raise refused("the data connection redirected too many times", 502)


async def _discard(response: httpx.Response, client: httpx.AsyncClient | None) -> None:
    await asyncio.shield(response.aclose())
    if client is not None:
        await asyncio.shield(client.aclose())


async def _disconnected(request: Request) -> None:
    while (await request.receive())["type"] != "http.disconnect":
        pass


async def _unless_abandoned(opening: Awaitable, request: Request | None):
    if request is None:
        return await opening
    task = asyncio.ensure_future(opening)
    gone = asyncio.ensure_future(_disconnected(request))
    try:
        await asyncio.wait({task, gone}, return_when=asyncio.FIRST_COMPLETED)
        if not task.done():
            raise refused("the browser stopped waiting for the answer", 499)
        return task.result()
    except BaseException:
        task.cancel()
        outcome = (await asyncio.gather(task, return_exceptions=True))[0]
        if isinstance(outcome, httpx.Response):
            outcome = (outcome, None)
        if isinstance(outcome, tuple):
            await _discard(*outcome)
        raise
    finally:
        gone.cancel()


async def guard(origin: str, opening: Callable[[], Awaitable], request: Request | None):
    admit(origin)
    try:
        answer = await _unless_abandoned(opening(), request)
    except (TimeoutError, httpx.TransportError):
        failed(origin)
        raise
    finally:
        left(origin)
    answered(origin)
    return answer


async def _reach(
    method: str,
    url: str,
    headers: dict[str, str],
    content: bytes | None,
    trusted: bool,
    request: Request | None,
    waits: tuple[float, float],
) -> tuple[httpx.Response, httpx.AsyncClient | None]:
    first_byte, idle = waits
    return await guard(
        origin_of(url),
        lambda: asyncio.wait_for(_open(method, url, headers, content, trusted, idle), first_byte),
        request,
    )


async def send(  # noqa: PLR0913
    source: models.ApiSource,
    method: str,
    url: str,
    headers: dict[str, str],
    body: str | bytes | None,
    accept: str | None,
    user_uuid: UUID,
    *,
    trusted: bool = False,
    frame: bool = False,
    request: Request | None = None,
    waits: tuple[float, float] | None = None,
) -> StreamingResponse:
    if method not in METHODS:
        raise refused(f"the method is one of {', '.join(sorted(METHODS))}")
    request_headers = dict(headers)
    if accept and not _has(request_headers, "Accept"):
        request_headers["Accept"] = accept
    if body is not None and not _has(request_headers, "Content-Type"):
        request_headers["Content-Type"] = "application/json"
    content = body.encode() if isinstance(body, str) else body

    acquire(user_uuid)
    try:
        try:
            response, client = await _reach(
                method, url, request_headers, content, trusted, request, waits or (HEADERS_SECONDS, IDLE_SECONDS)
            )
        except (TimeoutError, httpx.TimeoutException) as error:
            raise refused("the data connection did not answer in time", 504) from error
        except httpx.HTTPError as error:
            raise refused("the data connection could not be reached", 502) from error
        except (ValueError, OSError) as error:
            raise refused("the data connection sent an answer that cannot be followed", 502) from error

        answer_headers = {name: value for name, value in response.headers.items() if name.lower() not in NOT_PASSED_BACK}
        if frame:
            answer_headers = {k: v for k, v in answer_headers.items() if not k.lower().startswith("access-control-")}
            answer_headers["Access-Control-Allow-Origin"] = "*"
            answer_headers["Access-Control-Expose-Headers"] = "*"
            answer_headers["Content-Security-Policy"] = FRAME_SANDBOX
            answer_headers["Referrer-Policy"] = "no-referrer"
        else:
            answer_headers["Content-Security-Policy"] = SANDBOX
            answer_headers["X-Content-Type-Options"] = "nosniff"
        return Relayed(
            response,
            client,
            user_uuid,
            None if frame else MAX_STREAM_BYTES,
            status_code=response.status_code,
            headers=answer_headers,
        )
    except BaseException:
        release(user_uuid)
        raise


_json_cache: dict[tuple, tuple[float, object]] = {}
_json_pending: dict[tuple, asyncio.Future] = {}


async def fetch_json(
    source, email: str, trusted: bool, identity: Mapping[str, str], name: str = "widgets.json"
) -> object:
    key = (str(source.uuid), email, name)
    now = time.monotonic()
    cached = _json_cache.get(key)
    if cached and now - cached[0] < JSON_CACHE_SECONDS:
        return cached[1]
    if (pending := _json_pending.get(key)) is not None:
        return await asyncio.shield(pending)
    future: asyncio.Future = asyncio.get_running_loop().create_future()
    _json_pending[key] = future
    try:
        value = await _fetch_json(source, email, trusted, identity, name)
        remember(_json_cache, JSON_CACHE_ENTRIES, key, (time.monotonic(), value))
        future.set_result(value)
        return value
    except BaseException as error:
        future.set_exception(error if isinstance(error, Exception) else RuntimeError("cancelled"))
        future.exception()
        raise
    finally:
        _json_pending.pop(key, None)


async def read_json(
    source, email: str, trusted: bool, identity: Mapping[str, str], name: str
) -> tuple[int, object | None]:
    url, headers = target_of(source, f"{str(source.url).rstrip('/')}/{name}", {}, email, identity)
    headers["Accept"] = "application/json"
    body = bytearray()
    try:
        async with asyncio.timeout(HEADERS_SECONDS):
            response, client = await _reach("GET", url, headers, None, trusted, None, (HEADERS_SECONDS, IDLE_SECONDS))
            try:
                if response.status_code != HTTPStatus.OK:
                    return response.status_code, None
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_JSON_BYTES:
                        raise refused(f"{name} is too large", 502)
            finally:
                await _discard(response, client)
    except TimeoutError as error:
        raise refused("the data connection did not answer in time", 504) from error
    except httpx.HTTPError as error:
        raise refused("the data connection could not be reached", 502) from error
    try:
        return HTTPStatus.OK, await asyncio.to_thread(json.loads, bytes(body))
    except ValueError as error:
        raise refused(f"{name} is not JSON", 502) from error


async def _fetch_json(source, email: str, trusted: bool, identity: Mapping[str, str], name: str) -> object:
    status, value = await read_json(source, email, trusted, identity, name)
    if status != HTTPStatus.OK:
        raise refused(f"the data connection answered {status} for {name}", 502)
    return value


@asynccontextmanager
async def buffered(request: Request, limit: int) -> AsyncIterator[bytes]:
    length = request.headers.get("content-length")
    if length is not None and (not length.isdigit() or int(length) > limit):
        raise refused("the request is too large", 413)
    reserved = int(length) if length is not None else limit
    if _buffered["bytes"] + reserved > BODY_BUDGET_BYTES:
        raise refused("the server is busy; try again shortly", 503)
    _buffered["bytes"] += reserved
    try:
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > limit:
                raise refused("the request is too large", 413)
        yield bytes(body)
    finally:
        _buffered["bytes"] -= reserved
