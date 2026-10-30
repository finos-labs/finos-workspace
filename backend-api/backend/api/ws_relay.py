import asyncio
import contextlib
import random
import socket
import time
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

import aiohttp
from aiohttp.abc import AbstractResolver
from fastapi import WebSocket
from loguru import logger

from api.source_proxy import (
    CONNECT_SECONDS,
    answered,
    breaker_open,
    failed,
    local_development,
    origin_of,
    reach_host_machine,
)
from utilities.egress import EgressRefused, check_destination

MAX_MESSAGE_BYTES = 8 * 1024 * 1024
MAX_SOCKETS_PER_USER = 32
MAX_SOCKETS_PER_PROCESS = 1000
RECHECK_SECONDS = 60
RECHECK_JITTER = 0.2
HANDSHAKE_SECONDS = 15.0
HEARTBEAT_SECONDS = 30
UNSENDABLE_CLOSE_CODES = {None, 1005, 1006, 1015}
POLICY_CLOSE_CODE = 1008
TRY_AGAIN_CLOSE_CODE = 1013
FAILURE_CLOSE_CODE = 1011

_open_sockets: dict[UUID, int] = {}
_open_total = 0


class Refused(Exception):
    def __init__(self, message: str, close_code: int = POLICY_CLOSE_CODE):
        super().__init__(message)
        self.close_code = close_code


def _no_redirects() -> aiohttp.TraceConfig:
    async def refuse(session, context, params):
        raise Refused("the data connection redirected the socket")

    trace = aiohttp.TraceConfig()
    trace.on_request_redirect.append(refuse)
    return trace


class _Pinned(AbstractResolver):
    def __init__(self, address: str):
        self.address = address

    async def resolve(self, host: str, port: int = 0, family: int = socket.AF_INET) -> list[dict]:
        kind = socket.AF_INET6 if ":" in self.address else socket.AF_INET
        return [
            {
                "hostname": host,
                "host": self.address,
                "port": port,
                "family": kind,
                "proto": 0,
                "flags": socket.AI_NUMERICHOST,
            }
        ]

    @staticmethod
    async def close() -> None:
        return None


def _acquire(user_uuid: UUID) -> None:
    global _open_total  # noqa: PLW0603
    if _open_total >= MAX_SOCKETS_PER_PROCESS:
        raise Refused("the server is busy", TRY_AGAIN_CLOSE_CODE)
    if _open_sockets.get(user_uuid, 0) >= MAX_SOCKETS_PER_USER:
        raise Refused("too many sockets are open at once", TRY_AGAIN_CLOSE_CODE)
    _open_sockets[user_uuid] = _open_sockets.get(user_uuid, 0) + 1
    _open_total += 1


def _release(user_uuid: UUID) -> None:
    global _open_total  # noqa: PLW0603
    _open_total -= 1
    _open_sockets[user_uuid] -= 1
    if not _open_sockets[user_uuid]:
        del _open_sockets[user_uuid]


def _socket_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(parts._replace(scheme="wss" if parts.scheme == "https" else "ws"))


async def _connector_and_url(url: str, trusted: bool) -> tuple[aiohttp.TCPConnector, str, str | None]:
    if not (trusted or local_development()):
        try:
            destination = await check_destination(url, allow_private=False)
        except EgressRefused as error:
            message = f"a connection kept by a user who is not a superuser must be a public https address: {error}"
            raise Refused(message) from error
        return aiohttp.TCPConnector(resolver=_Pinned(destination.address)), _socket_url(url), None
    target, host_header = await reach_host_machine(url) if local_development() else (url, None)
    return aiohttp.TCPConnector(), _socket_url(target), host_header


async def _client_to_upstream(websocket: WebSocket, upstream: aiohttp.ClientWebSocketResponse) -> None:
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return
        text, data = message.get("text"), message.get("bytes")
        if text is not None:
            if len(text) > MAX_MESSAGE_BYTES:
                return
            await upstream.send_str(text)
        elif data is not None:
            if len(data) > MAX_MESSAGE_BYTES:
                return
            await upstream.send_bytes(data)


async def _upstream_to_client(websocket: WebSocket, upstream: aiohttp.ClientWebSocketResponse) -> None:
    async for message in upstream:
        if message.type == aiohttp.WSMsgType.TEXT:
            await websocket.send_text(message.data)
        elif message.type == aiohttp.WSMsgType.BINARY:
            await websocket.send_bytes(message.data)
        else:
            return


async def _watch(authorized: Callable[[], Awaitable[bool]], expires_at: float) -> None:
    while (remaining := expires_at - time.time()) > 0:
        await asyncio.sleep(min(RECHECK_SECONDS * random.uniform(1 - RECHECK_JITTER, 1 + RECHECK_JITTER), remaining))
        if time.time() >= expires_at:
            return
        try:
            if not await authorized():
                return
        except Exception as error:  # noqa: BLE001
            logger.warning(f"the access of an open data connection socket could not be checked: {type(error).__name__}")


async def _handshake(
    session: aiohttp.ClientSession,
    target: str,
    headers: dict[str, str],
    origin: str,
    protocols: tuple[str, ...],
    key: str,
) -> aiohttp.ClientWebSocketResponse:
    try:
        upstream = await asyncio.wait_for(
            session.ws_connect(
                target,
                headers=headers,
                origin=origin,
                protocols=protocols,
                max_msg_size=MAX_MESSAGE_BYTES,
                heartbeat=HEARTBEAT_SECONDS,
            ),
            HANDSHAKE_SECONDS,
        )
    except aiohttp.WSServerHandshakeError as error:
        answered(key)
        raise Refused("the data connection refused the socket", FAILURE_CLOSE_CODE) from error
    except (aiohttp.ClientError, TimeoutError, OSError) as error:
        failed(key)
        raise Refused("the data connection could not be reached", FAILURE_CLOSE_CODE) from error
    answered(key)
    return upstream


async def _close(
    tasks: list[asyncio.Task], upstream: aiohttp.ClientWebSocketResponse | None, session: aiohttp.ClientSession | None
) -> None:
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    for closing in (upstream, session):
        if closing is not None:
            with contextlib.suppress(Exception):
                await closing.close()


async def relay(
    websocket: WebSocket,
    url: str,
    headers: dict[str, str],
    origin: str,
    trusted: bool,
    user_uuid: UUID,
    expires_at: float,
    authorized: Callable[[], Awaitable[bool]],
) -> None:
    held = False
    session: aiohttp.ClientSession | None = None
    upstream: aiohttp.ClientWebSocketResponse | None = None
    tasks: list[asyncio.Task] = []
    try:
        _acquire(user_uuid)
        held = True
        key = origin_of(url)
        if breaker_open(key):
            raise Refused("the data connection is not answering", TRY_AGAIN_CLOSE_CODE)
        connector, target, host_header = await _connector_and_url(url, trusted)
        session = aiohttp.ClientSession(
            connector=connector,
            timeout=aiohttp.ClientTimeout(total=None, connect=CONNECT_SECONDS),
            trace_configs=[_no_redirects()],
        )
        upstream_headers = {k: v for k, v in headers.items() if k.lower() not in {"accept-encoding", "host", "origin"}}
        if host_header:
            upstream_headers["Host"] = host_header
        upstream = await _handshake(
            session, target, upstream_headers, origin, tuple(websocket.scope.get("subprotocols") or ()), key
        )
        await websocket.accept(subprotocol=upstream.protocol or None)
        logger.debug(f"data connection socket opened user={user_uuid}")
        tasks = [
            asyncio.create_task(_client_to_upstream(websocket, upstream)),
            asyncio.create_task(_upstream_to_client(websocket, upstream)),
            asyncio.create_task(_watch(authorized, expires_at)),
        ]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        failed = [task for task in done if task.exception() is not None]
        for task in failed:
            logger.warning(f"data connection socket ended with {type(task.exception()).__name__}")
        if tasks[2] in done:
            code = POLICY_CLOSE_CODE
        elif tasks[1] in done and failed:
            code = FAILURE_CLOSE_CODE
        else:
            code = upstream.close_code
        with contextlib.suppress(Exception):
            await websocket.close(code=1000 if code in UNSENDABLE_CLOSE_CODES else code)
    except Refused as error:
        logger.debug(f"data connection socket refused: {error}")
        with contextlib.suppress(Exception):
            await websocket.close(code=error.close_code)
    finally:
        await _close(tasks, upstream, session)
        if held:
            _release(user_uuid)
