import socket
import time

import pytest

from utilities import egress


@pytest.fixture(autouse=True)
def fresh_cache():
    egress._dns_cache.clear()
    yield
    egress._dns_cache.clear()


def answers(*addresses):
    return [(socket.AF_INET6 if ":" in a else socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, 443)) for a in addresses]


@pytest.mark.asyncio
async def test_an_ipv4_address_comes_before_an_ipv6_one_and_the_resolver_order_is_kept(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: answers("2001:db8::1", "93.184.216.35", "93.184.216.34"))
    assert await egress.resolve("example.test", 443) == ["93.184.216.35", "93.184.216.34", "2001:db8::1"]


@pytest.mark.asyncio
async def test_a_name_that_does_not_resolve_in_time_is_refused_and_does_not_hang_the_caller(monkeypatch):
    monkeypatch.setattr(egress, "DNS_SECONDS", 0.1)
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: time.sleep(0.5))
    started = time.monotonic()
    with pytest.raises(egress.EgressRefused, match="in time"):
        await egress.resolve("tarpit.test", 443)
    assert time.monotonic() - started < 0.4


@pytest.mark.asyncio
async def test_a_name_is_asked_for_once_in_a_while(monkeypatch):
    calls = []

    def lookup(*args, **kwargs):
        calls.append(1)
        return answers("93.184.216.34")

    monkeypatch.setattr(socket, "getaddrinfo", lookup)
    for _ in range(5):
        assert await egress.resolve("example.test", 443) == ["93.184.216.34"]
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_a_name_that_does_not_exist_is_refused(monkeypatch):
    def nothing(*args, **kwargs):
        raise socket.gaierror("no")

    monkeypatch.setattr(socket, "getaddrinfo", nothing)
    with pytest.raises(egress.EgressRefused, match="does not resolve"):
        await egress.resolve("nowhere.test", 443)
