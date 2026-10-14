"""What the runner relays for its backends (docs/widget-plugins/SERVER-SIDE.md 5.4, R4).

- **The way in.** One unix socket per backend that the API's group may connect to (the API
  names it in ``WIDGET_PLUGIN_BACKENDS`` as ``unix:<path>``), relayed to the socket the
  backend listens on in its sandbox. The runner owns it, so it outlives a restart of the
  backend, and nothing else of the backend is reachable.
- **The ways out.** One unix socket per approved endpoint, which only the backend's group
  may connect to, relayed to that host and port. The host is resolved when a connection
  opens and the address is checked: never loopback (the API and Redis of a single-image
  deployment listen there), link-local (a cloud's metadata service), multicast or
  unspecified. The connection goes to the address that was checked.
- **The broker.** With ``broker = true``, ``POST /internal/plugin-broker/data/<id>`` and
  nothing else reaches the API, one request a connection.

Logs name the backend, the endpoint and the outcome; never what passes through.
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import logging
import os
import re
import socket
from collections.abc import Awaitable, Callable

log = logging.getLogger("plugin_runner")

CONNECT_TIMEOUT = 10
MAX_CONNECTIONS = 64
MAX_HEAD = 16 * 1024
MAX_BROKER_BODY = 1024 * 1024
BROKER_PATH = re.compile(r"^/internal/plugin-broker/data/[a-z][a-z0-9_-]{0,63}$")
BROKER_HEADERS = ("content-type", "x-workspace-call")
REQUEST_LINE = re.compile(r"^POST (?P<target>\S+) HTTP/1\.1$")

Handler = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
        if writer.can_write_eof():
            writer.write_eof()
    except (ConnectionError, OSError):
        pass


async def splice(
    a: tuple[asyncio.StreamReader, asyncio.StreamWriter],
    b: tuple[asyncio.StreamReader, asyncio.StreamWriter],
) -> None:
    try:
        await asyncio.gather(_pipe(a[0], b[1]), _pipe(b[0], a[1]))
    finally:
        for writer in (a[1], b[1]):
            writer.close()
            with contextlib.suppress(ConnectionError, OSError):
                await writer.wait_closed()


def allowed_address(address: str) -> bool:
    """Whether an egress relay may connect to ``address``."""
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not (ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved)


async def unix_server(path: str, handler: Handler, *, uid: int, gid: int, mode: int) -> asyncio.base_events.Server:
    with contextlib.suppress(FileNotFoundError):
        os.unlink(path)
    slots = asyncio.Semaphore(MAX_CONNECTIONS)

    async def bounded(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if slots.locked():
            writer.close()
            return
        async with slots:
            await handler(reader, writer)

    server = await asyncio.start_unix_server(bounded, path=path, limit=MAX_HEAD)
    os.chown(path, uid, gid)
    os.chmod(path, mode)
    return server


def way_in(plugin: str, backend_socket: str) -> Handler:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            upstream = await asyncio.wait_for(asyncio.open_unix_connection(backend_socket), CONNECT_TIMEOUT)
        except (OSError, TimeoutError):
            log.warning("%s: the backend is not listening", plugin)
            writer.close()
            return
        await splice((reader, writer), upstream)

    return handle


async def connect_checked(host: str, port: int) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """Resolves ``host`` and connects to the first allowed address, that one and no other."""
    loop = asyncio.get_running_loop()
    infos = await asyncio.wait_for(loop.getaddrinfo(host, port, type=socket.SOCK_STREAM), CONNECT_TIMEOUT)
    refused = False
    for *_, sockaddr in infos:
        address = sockaddr[0]
        if not allowed_address(address):
            refused = True
            continue
        try:
            return await asyncio.wait_for(asyncio.open_connection(address, port), CONNECT_TIMEOUT)
        except (OSError, TimeoutError):
            continue
    raise ConnectionRefusedError("not an allowed address" if refused else "unreachable")


def way_out(plugin: str, host: str, port: int) -> Handler:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            upstream = await connect_checked(host, port)
        except (OSError, TimeoutError) as error:
            log.warning("%s: egress to %s:%s refused: %s", plugin, host, port, error)
            writer.close()
            return
        log.info("%s: egress to %s:%s", plugin, host, port)
        await splice((reader, writer), upstream)

    return handle


async def _refuse(writer: asyncio.StreamWriter, status: str) -> None:
    writer.write(f"HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".encode())
    with contextlib.suppress(ConnectionError, OSError):
        await writer.drain()
    writer.close()


def broker(plugin: str, api_host: str, api_port: int) -> Handler:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), CONNECT_TIMEOUT)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError, ConnectionError):
            await _refuse(writer, "400 Bad Request")
            return
        lines = head.decode("latin-1").split("\r\n")
        request = REQUEST_LINE.fullmatch(lines[0])
        target = request["target"] if request else ""
        if not BROKER_PATH.fullmatch(target):
            log.warning("%s: a request that is not the broker's was refused", plugin)
            await _refuse(writer, "403 Forbidden")
            return
        headers: dict[str, str] = {}
        for line in lines[1:]:
            if not line:
                continue
            name, _, value = line.partition(":")
            headers[name.strip().lower()] = value.strip()
        length = headers.get("content-length", "")
        if "transfer-encoding" in headers or not length.isdigit() or int(length) > MAX_BROKER_BODY:
            await _refuse(writer, "411 Length Required")
            return
        try:
            body = await asyncio.wait_for(reader.readexactly(int(length)), CONNECT_TIMEOUT)
            upstream_reader, upstream_writer = await asyncio.wait_for(
                asyncio.open_connection(api_host, api_port), CONNECT_TIMEOUT
            )
        except (asyncio.IncompleteReadError, OSError, TimeoutError):
            await _refuse(writer, "502 Bad Gateway")
            return
        forwarded = [
            f"POST {target} HTTP/1.1",
            f"Host: {api_host}:{api_port}",
            "Connection: close",
            f"Content-Length: {len(body)}",
        ]
        forwarded += [f"{name}: {headers[name]}" for name in BROKER_HEADERS if name in headers]
        upstream_writer.write(("\r\n".join(forwarded) + "\r\n\r\n").encode("latin-1") + body)
        try:
            await upstream_writer.drain()
            if upstream_writer.can_write_eof():
                upstream_writer.write_eof()
        except (ConnectionError, OSError):
            pass
        log.info("%s: a broker call", plugin)
        # The answer goes back; nothing more of the backend's reaches the API
        try:
            await _pipe(upstream_reader, writer)
        finally:
            for side in (upstream_writer, writer):
                side.close()
                with contextlib.suppress(ConnectionError, OSError):
                    await side.wait_closed()

    return handle
