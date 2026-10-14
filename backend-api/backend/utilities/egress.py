"""Outbound requests to hosts a third party names (docs/widget-plugins/SERVER-SIDE.md 3.3).

The API resolves the host itself and refuses it when any address it resolves to is
loopback, private, link-local, shared, multicast, reserved or a cloud metadata address,
in IPv4 or IPv6, unless the caller allows private hosts. The connection then goes to an
address that was checked, with the name kept for the ``Host`` header and for TLS, so a
second DNS answer cannot send it elsewhere. TLS verification stays on. Redirects are not
followed.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

import httpx

# Addresses a request to a public service never needs
BLOCKED_NETWORKS = tuple(
    ipaddress.ip_network(network)
    for network in (
        "0.0.0.0/8",  # "this" network
        "10.0.0.0/8",  # private
        "100.64.0.0/10",  # shared address space (carrier-grade NAT)
        "127.0.0.0/8",  # loopback
        "169.254.0.0/16",  # link-local, with the cloud metadata address
        "172.16.0.0/12",  # private
        "192.0.0.0/24",  # IETF protocol assignments
        "192.0.2.0/24",  # documentation
        "192.88.99.0/24",  # 6to4 relay anycast
        "192.168.0.0/16",  # private
        "198.18.0.0/15",  # benchmarking
        "198.51.100.0/24",  # documentation
        "203.0.113.0/24",  # documentation
        "224.0.0.0/4",  # multicast
        "240.0.0.0/4",  # reserved, and the broadcast address
        "::/128",  # unspecified
        "::1/128",  # loopback
        # An IPv4-mapped address (::ffff:0:0/96) is checked as the IPv4 address it maps
        "64:ff9b::/96",  # NAT64
        "64:ff9b:1::/48",  # local-use NAT64
        "100::/64",  # discard-only
        "2001::/23",  # IETF protocol assignments
        "2001:db8::/32",  # documentation
        "2002::/16",  # 6to4
        "fc00::/7",  # unique local, with fd00:ec2::254, a cloud metadata address
        "fe80::/10",  # link-local
        "ff00::/8",  # multicast
    )
)


HTTPS_PORT = 443


class EgressRefused(Exception):
    """A request the guard does not send: the reason is safe to show and to log."""


@dataclass(frozen=True)
class Destination:
    """A checked destination: the name of the URL and an address it resolved to."""

    host: str
    port: int
    address: str


def blocked(address: str) -> bool:
    """Whether a request may not go to this address."""
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return any(ip in network for network in BLOCKED_NETWORKS if network.version == ip.version)


async def resolve(host: str, port: int) -> list[str]:
    """The addresses a host name resolves to, by the API's own resolver."""
    try:
        answers = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise EgressRefused(f"{host} does not resolve") from error
    return sorted({answer[4][0] for answer in answers})


async def check_destination(url: str, *, allow_private: bool = False) -> Destination:
    """Resolve a URL's host and check every address it resolves to."""
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
    """The URL with its host replaced by the checked address."""
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
    """A request to the checked address that keeps the name for ``Host`` and for TLS
    (SNI and the certificate's name), so the certificate is verified against the name."""
    host_header = destination.host if destination.port == HTTPS_PORT else f"{destination.host}:{destination.port}"
    return httpx.Request(
        method,
        pinned_url(url, destination),
        headers={**headers, "Host": host_header},
        content=content,
        extensions={"sni_hostname": destination.host},
    )
