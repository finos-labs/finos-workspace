from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

import httpx

BLOCKED_NETWORKS = tuple(
    ipaddress.ip_network(network)
    for network in (
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.0.0.0/24",
        "192.0.2.0/24",
        "192.88.99.0/24",
        "192.168.0.0/16",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "224.0.0.0/4",
        "240.0.0.0/4",
        "::/128",
        "::1/128",
        "64:ff9b::/96",
        "64:ff9b:1::/48",
        "100::/64",
        "2001::/23",
        "2001:db8::/32",
        "2002::/16",
        "fc00::/7",
        "fe80::/10",
        "ff00::/8",
    )
)


HTTPS_PORT = 443


class EgressRefused(Exception):
    ...


@dataclass(frozen=True)
class Destination:
    host: str
    port: int
    address: str


def blocked(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return any(ip in network for network in BLOCKED_NETWORKS if network.version == ip.version)


async def resolve(host: str, port: int) -> list[str]:
    try:
        answers = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise EgressRefused(f"{host} does not resolve") from error
    return sorted({answer[4][0] for answer in answers})


async def check_destination(url: str, *, allow_private: bool = False) -> Destination:
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise EgressRefused("only https is allowed")
    if parts.username or parts.password:
        raise EgressRefused("credentials in the URL are not allowed")
    host = (parts.hostname or "").lower()
    if not host:
        raise EgressRefused("the URL has no host")
    port = parts.port or HTTPS_PORT
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    addresses = [str(literal)] if literal is not None else await resolve(host, port)
    if not addresses:
        raise EgressRefused(f"{host} does not resolve")
    if not allow_private:
        refused = [address for address in addresses if blocked(address)]
        if refused:
            raise EgressRefused(f"{host} resolves to an address that is not public")
    return Destination(host=host, port=port, address=addresses[0])


def pinned_url(url: str, destination: Destination) -> str:
    parts = urlsplit(url)
    address = f"[{destination.address}]" if ":" in destination.address else destination.address
    netloc = address if parts.port is None else f"{address}:{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))


def pinned_request(
    method: str,
    url: str,
    destination: Destination,
    *,
    headers: dict[str, str],
    content: bytes | None = None,
) -> httpx.Request:
    host_header = destination.host if destination.port == HTTPS_PORT else f"{destination.host}:{destination.port}"
    return httpx.Request(
        method,
        pinned_url(url, destination),
        headers={**headers, "Host": host_header},
        content=content,
        extensions={"sni_hostname": destination.host},
    )
