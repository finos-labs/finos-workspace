"""Fake hosts for the API's MCP traffic, without a network.

The API sends its MCP requests through `routers.app.mcp_oauth.mcp_http`, whose transport
resolves each host, refuses addresses that are not public and connects to the address it
checked. These fakes stand in below that check: `FakeHosts.resolve` answers the DNS
lookups, and `FakeNetwork` answers the connections with in-memory HTTP/1.1 servers that
hand each request to the handler of its Host. Every connection is recorded, so a test can
tell that a refused address was never reached.
"""

import ipaddress
import socket
from collections.abc import Callable
from typing import Any

import anyio
import h11
import httpcore
import httpx

Handler = Callable[[httpx.Request], httpx.Response]


class FakeHosts:
    """The hosts the tests' MCP and authorization servers run on."""

    def __init__(self) -> None:
        self.addresses: dict[str, list[str]] = {}
        self.handlers: dict[str, Handler] = {}
        # (address, port) of every connection, and the TLS server name of the https ones
        self.connections: list[tuple[str, int]] = []
        self.tls_names: list[str] = []
        self.requests: list[httpx.Request] = []

    def add(self, host: str, *addresses: str, handler: Handler | None = None) -> None:
        self.addresses[host] = list(addresses)
        if handler is not None:
            self.handlers[host] = handler

    async def resolve(self, host: str, _port: int) -> list[str]:
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            return [host]
        if host not in self.addresses:
            raise socket.gaierror(socket.EAI_NONAME, f"{host} is not a fake host")
        return self.addresses[host]

    def requests_to(self, host: str) -> list[httpx.Request]:
        return [request for request in self.requests if request.url.host == host]

    def answer(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        handler = self.handlers.get(request.url.host)
        if handler is None:
            return httpx.Response(404, text="No such fake host")
        return handler(request)


class _FakeStream(httpcore.AsyncNetworkStream):
    """One connection to a fake host: an HTTP/1.1 server (h11) in memory."""

    def __init__(self, hosts: FakeHosts) -> None:
        self._hosts = hosts
        self._server = h11.Connection(h11.SERVER)
        self._outgoing = bytearray()
        self._scheme = "http"
        self._request: h11.Request | None = None
        self._body = bytearray()

    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        data = bytes(self._outgoing[:max_bytes])
        del self._outgoing[:max_bytes]
        return data

    async def write(self, buffer: bytes, timeout: float | None = None) -> None:
        # The client writes nothing at the end of a body; to h11 nothing is end of stream
        if not buffer:
            return
        self._server.receive_data(buffer)
        while True:
            event = self._server.next_event()
            if event is h11.NEED_DATA or event is h11.PAUSED:
                return
            if isinstance(event, h11.Request):
                self._request, self._body = event, bytearray()
            elif isinstance(event, h11.Data):
                self._body.extend(event.data)
            elif isinstance(event, h11.EndOfMessage):
                self._respond()

    def _respond(self) -> None:
        assert self._request is not None
        headers = [(name.decode(), value.decode()) for name, value in self._request.headers]
        host = next(value for name, value in headers if name.lower() == "host")
        request = httpx.Request(
            self._request.method.decode(),
            f"{self._scheme}://{host}{self._request.target.decode()}",
            headers=headers,
            content=bytes(self._body),
        )
        response = self._hosts.answer(request)
        body = response.read()
        response_headers = [
            (name, value)
            for name, value in response.headers.multi_items()
            if name.lower() not in {"content-length", "transfer-encoding"}
        ]
        response_headers.append(("content-length", str(len(body))))
        self._outgoing += self._server.send(
            h11.Response(status_code=response.status_code, headers=response_headers)
        )
        self._outgoing += self._server.send(h11.Data(data=body))
        self._outgoing += self._server.send(h11.EndOfMessage())
        self._server.start_next_cycle()

    async def aclose(self) -> None:
        return None

    async def start_tls(
        self, ssl_context: Any, server_hostname: str | None = None, timeout: float | None = None
    ) -> httpcore.AsyncNetworkStream:
        self._scheme = "https"
        self._hosts.tls_names.append(server_hostname or "")
        return self

    def get_extra_info(self, info: str) -> Any:
        return None


class FakeNetwork(httpcore.AsyncNetworkBackend):
    """The network below the API's address check: connections go to the fake hosts."""

    def __init__(self, hosts: FakeHosts) -> None:
        self._hosts = hosts

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Any = None,
    ) -> httpcore.AsyncNetworkStream:
        self._hosts.connections.append((host, port))
        return _FakeStream(self._hosts)

    async def connect_unix_socket(
        self, path: str, timeout: float | None = None, socket_options: Any = None
    ) -> httpcore.AsyncNetworkStream:
        raise httpcore.ConnectError("No unix sockets here")

    async def sleep(self, seconds: float) -> None:
        await anyio.sleep(seconds)
