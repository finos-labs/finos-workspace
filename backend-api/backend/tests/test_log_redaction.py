"""Credentials never reach the logs, and rate limits count the address the server resolved."""

import logging
import time

import pytest
from httpx import ASGITransport, AsyncClient
from loguru import logger
from starlette.requests import Request
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from api.rate_limit import TRUSTED_PROXIES, limiter
from utilities import log_helpers
from utilities.config import settings
from utilities.log_helpers import MASK, redact


@pytest.mark.parametrize(
    ("message", "secret"),
    [
        ("Request headers: {'authorization': 'Bearer abc.def'}", "abc.def"),
        ("{'cookie': '__Host-ws_session=SESSIONVALUE; theme=dark'}", "SESSIONVALUE"),
        ("{'set-cookie': '__Host-ws_totp=TOTPVALUE; Path=/'}", "TOTPVALUE"),
        ("{'x-workspace-authorization': 'Bearer service.jwt'}", "service.jwt"),
        ("{'x-metering-authorization': 'Bearer metering.jwt'}", "metering.jwt"),
        ("{'x-api-key': 'backend-key-1'}", "backend-key-1"),
        ('{"password": "hunter2", "email": "a@b.c"}', "hunter2"),
        ('{"openai_api_key": "sk-proj-123"}', "sk-proj-123"),
        ('{"client_secret": "cs-456"}', "cs-456"),
        ('{"refresh_token": "rt-789"}', "rt-789"),
        ('{"totp_token": 123456}', "123456"),
        ("Authorization: Bearer eyJhbGciOi.payload.sig", "eyJhbGciOi.payload.sig"),
        ("Cookie: __Host-ws_session=abc123; other=1", "abc123"),
        ("GET /app/x?token=qs-token&page=2", "qs-token"),
        ("api_key=form-key&name=x", "form-key"),
        ("kwargs password='kw-pass' user='x'", "kw-pass"),
        ("created ws_mcp_ZyXw987 for a user", "ZyXw987"),
        ("{'secret': 'unterminated value", "unterminated value"),
        ("{'Authorization': 'Basic dXNlcjpwYXNz'}", "dXNlcjpwYXNz"),
        ("value with 'secret': 'a\\'b' done", "a\\'b"),
        ("GET /app/files/presigned/f.csv?Expires=1&Signature=hmac-sig HTTP/1.1", "hmac-sig"),
        ("https://b.s3.amazonaws.com/f?X-Amz-Signature=s3-sig&X-Amz-Date=1", "s3-sig"),
        ("https://a.blob.core.windows.net/c/f?sv=1&sig=azure-sig", "azure-sig"),
    ],
)
def test_credentials_are_masked(message, secret):
    redacted = redact(message)
    assert secret not in redacted
    assert MASK in redacted


@pytest.mark.parametrize(
    "message",
    [
        "Rate limit for 1.2.3.4",
        "KeyError: 'missing'",
        "{'email': 'a@b.c', 'theme': 'dark'}",
        "GET /app/dashboards?page=2 200",
        "design: dark, signal=on",
    ],
)
def test_other_text_is_kept(message):
    assert redact(message) == message


@pytest.mark.parametrize(
    "message",
    [
        "'secret': '" + "\\" * 50_000,
        "key" * 20_000 + ": x",
        "'" + "key" * 20_000 + "': 1",
        ("a" * 20_000 + "token") * 5,
        "x" * 200_000,
        "Bearer " + "a" * 100_000,
    ],
)
def test_redaction_runs_in_linear_time(message):
    start = time.perf_counter()
    redact(message)
    assert time.perf_counter() - start < 0.5


def test_setting_values_are_masked_and_not_named(monkeypatch):
    monkeypatch.setattr(log_helpers, "get_secrets", lambda: {"JWT_SECRET": "the-jwt-value"})

    shown = log_helpers.obfuscate_secrets("signed with the-jwt-value")

    assert shown == f"signed with {log_helpers.MASK}"


def test_json_log_records_are_redacted(monkeypatch):
    monkeypatch.setattr(log_helpers, "get_secrets", dict)

    class Exc:
        type = ValueError
        value = ValueError("{'password': 'in-the-exception'}")
        traceback = None

    record = {
        "time": __import__("datetime").datetime.now(),
        "level": type("L", (), {"name": "INFO"})(),
        "name": "x",
        "message": "Authorization: Bearer in-the-message",
        "function": "f",
        "line": 1,
        "exception": Exc,
        "extra": {},
    }
    serialized = log_helpers.serialize(record)
    assert "in-the-message" not in serialized
    assert "in-the-exception" not in serialized


def test_tracebacks_do_not_show_local_variables(capsys):
    """loguru's diagnose mode would print the value of every local variable."""
    settings.setup_logging()
    credential = "".join(["plain", "-credential-", "value"])

    def fail(value):
        raise RuntimeError("boom")

    try:
        fail(credential)
    except RuntimeError:
        logger.exception("failed")
    output = capsys.readouterr().out
    with capsys.disabled():
        settings.setup_logging()
    assert "boom" in output
    assert "plain-credential-value" not in output


async def test_validation_errors_do_not_log_the_request_body():
    from main import app

    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(str(message)), level="DEBUG")
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as client:
            response = await client.post(
                "/app/login",
                json={"email": "user@mail.test", "password": "weak-pass-in-body"},
            )
    finally:
        logger.remove(sink)
    assert response.status_code == 422
    assert any("Request validation failed" in line for line in lines)
    assert not any("weak-pass-in-body" in line for line in lines)


def _request(client: tuple[str, int], headers: dict[str, str]) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": client,
            "scheme": "http",
            "server": ("test", 80),
        }
    )


def test_rate_limit_key_ignores_a_forwarded_header_it_did_not_resolve():
    request = _request(("203.0.113.9", 4000), {"X-Forwarded-For": "198.51.100.1"})
    assert limiter._key_func(request) == "203.0.113.9"


@pytest.mark.parametrize(
    ("peer", "expected"),
    [
        # A proxy on loopback or a private network passes the client on
        ("127.0.0.1", "198.51.100.1"),
        ("10.4.0.7", "198.51.100.1"),
        ("172.18.0.2", "198.51.100.1"),
        # A client on the internet cannot pick its own rate-limit bucket
        ("203.0.113.9", "203.0.113.9"),
    ],
)
async def test_forwarded_address_counts_only_from_trusted_proxies(peer, expected):
    seen: list[str] = []

    async def app(scope, receive, send):
        seen.append(limiter._key_func(Request(scope)))
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    middleware = ProxyHeadersMiddleware(app, trusted_hosts=TRUSTED_PROXIES)
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"x-forwarded-for", b"198.51.100.1")],
        "client": (peer, 4000),
        "scheme": "http",
        "server": ("test", 80),
    }

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(_message):
        return None

    await middleware(scope, receive, send)
    assert seen == [expected]


def test_gunicorn_trusts_only_loopback_and_private_networks():
    from pathlib import Path

    run = (Path(__file__).resolve().parent.parent / "run.py").read_text()
    assert '"forwarded_allow_ips": TRUSTED_PROXIES' in run
    assert "*" not in TRUSTED_PROXIES


def test_the_rate_limiter_logs_no_headers():
    from pathlib import Path

    import api.rate_limit

    source = Path(api.rate_limit.__file__).read_text()
    assert "request.headers)" not in source
    assert "logger" not in source


def test_the_http_clients_log_no_request_urls():
    """httpx logs each request's full URL at INFO, and a URL can carry a credential."""
    log_helpers.setup_logging(settings)

    assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)
    assert not logging.getLogger("httpcore").isEnabledFor(logging.INFO)
