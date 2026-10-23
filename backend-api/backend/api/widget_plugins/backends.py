from __future__ import annotations

import base64
import contextlib
import dataclasses
import hashlib
import hmac
import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from api import crypto
from utilities.config import settings

from .proxy import CallError

PROTOCOL = 1
TOKEN_PREFIX = "wpc1."  # noqa: S105 - a format marker, not a credential
TOKEN_SECONDS = 60
SECRET_HEADER = "X-Workspace-Secret-"  # noqa: S105 - a header name, not a credential
CALL_HEADER = "X-Workspace-Call"
_IDENTITY_TIMEOUT = 5.0
_PLUGIN_ID = re.compile(r"[a-z][a-z0-9-]{1,47}")

IDENTITY_OK = "ok"
IDENTITY_MISMATCH = "mismatch"
IDENTITY_UNREACHABLE = "unreachable"
IDENTITY_UNREGISTERED = "unregistered"


def _key(purpose: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"widget-plugin " + purpose).derive(
        crypto.decode_key_material(settings.WORKSPACE_AES_KEY)
    )


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def pseudonym(plugin_id: str, user_uuid: str) -> str:
    digest = hmac.new(_key(b"caller id"), f"{plugin_id}\0{user_uuid}".encode(), hashlib.sha256).digest()
    return _b64(digest)


def mint_token(claims: dict[str, Any], seconds: int = TOKEN_SECONDS) -> str:
    nonce = os.urandom(12)
    body = json.dumps({**claims, "exp": int(time.time()) + seconds}, separators=(",", ":")).encode()
    return TOKEN_PREFIX + _b64(nonce + AESGCM(_key(b"call context")).encrypt(nonce, body, None))


def read_token(token: str) -> dict[str, Any]:
    try:
        if not token.startswith(TOKEN_PREFIX):
            raise ValueError
        raw = _unb64(token.removeprefix(TOKEN_PREFIX))
        claims = json.loads(AESGCM(_key(b"call context")).decrypt(raw[:12], raw[12:], None))
    except Exception as error:  # noqa: BLE001 - any failure is the same refusal
        raise CallError("invalid_token", "the call-context token is not valid", status=401) from error
    if not isinstance(claims, dict) or claims.get("exp", 0) < time.time():
        raise CallError("invalid_token", "the call-context token has expired", status=401)
    return claims


def registered_url(plugin_id: str) -> str | None:
    url = settings.WIDGET_PLUGIN_BACKENDS.get(plugin_id)
    if not url or not _PLUGIN_ID.fullmatch(plugin_id):
        return None
    if url.startswith("unix:/") or urlsplit(url).scheme in {"http", "https"}:
        return url.rstrip("/")
    return None


def _client(url: str, timeout: float) -> tuple[httpx.AsyncClient, str]:
    if url.startswith("unix:"):
        transport = httpx.AsyncHTTPTransport(uds=url.removeprefix("unix:"))
        return httpx.AsyncClient(transport=transport, timeout=timeout, follow_redirects=False), "http://backend"
    return httpx.AsyncClient(timeout=timeout, follow_redirects=False), url


async def request(  # noqa: PLR0913 - one request, its limits and its headers
    url: str,
    method: str,
    path: str,
    *,
    json_body: Any = None,
    headers: dict[str, str] | None = None,
    timeout: float,
    limit: int,
) -> tuple[int, str, bytes]:
    client, base = _client(url, timeout)
    try:
        async with client:
            outgoing = client.build_request(method, base + path, json=json_body, headers=headers or {})
            response = await client.send(outgoing, stream=True)
            try:
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > limit:
                        raise CallError("response_too_large", f"the answer is larger than {limit} bytes", 502)
                    chunks.append(chunk)
            finally:
                await response.aclose()
    except httpx.TimeoutException as error:
        raise CallError("timeout", "the backend did not answer in time", status=504) from error
    except httpx.HTTPError as error:
        raise CallError("backend_unreachable", "the backend could not be reached", status=502) from error
    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    return response.status_code, content_type, b"".join(chunks)


@dataclass
class Identity:
    state: str
    detail: str
    digest: str | None = None
    checked_at: float = 0.0
    changed: bool = False


_identities: dict[str, tuple[str, Identity]] = {}


async def check_identity(plugin_id: str, version: str, digest: str, *, force: bool = False) -> Identity:
    cached = _identities.get(plugin_id)
    ttl = settings.WIDGET_PLUGIN_BACKEND_IDENTITY_SECONDS
    if not force and cached and cached[0] == digest and time.time() - cached[1].checked_at < ttl:
        return dataclasses.replace(cached[1], changed=False)
    url = registered_url(plugin_id)
    if url is None:
        result = Identity(IDENTITY_UNREGISTERED, "not listed in WIDGET_PLUGIN_BACKENDS")
    else:
        result = await _ask_identity(url, plugin_id, version, digest)
    result.checked_at = time.time()
    result.changed = cached is None or cached[1].state != result.state
    _identities[plugin_id] = (digest, result)
    return result


async def _ask_identity(url: str, plugin_id: str, version: str, digest: str) -> Identity:
    try:
        status, content_type, raw = await request(
            url, "GET", "/.workspace/identity", timeout=_IDENTITY_TIMEOUT, limit=16 * 1024
        )
        answer = json.loads(raw) if status == 200 and content_type == "application/json" else None  # noqa: PLR2004
    except (CallError, ValueError):
        return Identity(IDENTITY_UNREACHABLE, "the backend did not answer its identity")
    if not isinstance(answer, dict):
        return Identity(IDENTITY_UNREACHABLE, f"the identity answer was {status} {content_type or 'without a type'}")
    found = answer.get("digest") if isinstance(answer.get("digest"), str) else None
    expected = {"plugin": plugin_id, "version": version, "digest": digest, "protocol": PROTOCOL}
    differs = sorted(key for key, value in expected.items() if answer.get(key) != value)
    if differs:
        return Identity(IDENTITY_MISMATCH, f"its {', '.join(differs)} differ from the approved version", found)
    return Identity(IDENTITY_OK, "the approved version", found)


def last_identity(plugin_id: str) -> Identity | None:
    cached = _identities.get(plugin_id)
    return cached[1] if cached else None


@dataclass
class _Breaker:
    failures: int = 0
    open_until: float = 0.0


_breakers: dict[str, _Breaker] = {}


def breaker_open(plugin_id: str) -> bool:
    breaker = _breakers.get(plugin_id)
    return bool(breaker and breaker.open_until > time.time())


def record_outcome(plugin_id: str, failed: bool) -> None:
    breaker = _breakers.setdefault(plugin_id, _Breaker())
    if not failed:
        breaker.failures, breaker.open_until = 0, 0.0
        return
    breaker.failures += 1
    if breaker.failures >= settings.WIDGET_PLUGIN_BACKEND_BREAKER_FAILURES:
        breaker.open_until = time.time() + settings.WIDGET_PLUGIN_BACKEND_BREAKER_SECONDS
        breaker.failures = settings.WIDGET_PLUGIN_BACKEND_BREAKER_FAILURES - 1


def breaker_state(plugin_id: str) -> str:
    return "open" if breaker_open(plugin_id) else "closed"


def reset(plugin_id: str | None = None) -> None:
    for registry in (_identities, _breakers):
        if plugin_id is None:
            registry.clear()
        else:
            registry.pop(plugin_id, None)


@contextlib.contextmanager
def outcome(plugin_id: str):
    try:
        yield
    except CallError as error:
        record_outcome(plugin_id, error.code in {"timeout", "backend_unreachable", "backend_error"})
        raise
    else:
        record_outcome(plugin_id, False)
