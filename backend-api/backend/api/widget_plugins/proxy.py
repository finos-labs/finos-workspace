"""Declarative proxies (docs/widget-plugins/SERVER-SIDE.md 3).

A plugin declares request templates; the API checks them when the package is discovered,
and for a call fills one with the frame's arguments and the plugin's secrets and sends it.
The frame names a proxy and gives arguments: it never builds a URL or a header, and never
sees a secret.
"""

from __future__ import annotations

import json
import re
import ssl
import time
from dataclasses import dataclass
from typing import Annotated, Any, Literal
from urllib.parse import quote, urlencode, urlsplit

import httpx
from pydantic import (
    BaseModel as PydanticBaseModel,
    ConfigDict,
    Field,
    StringConstraints,
)

from utilities.egress import HTTPS_PORT, Destination, EgressRefused, check_destination, pinned_request

from . import csp as csp_rules

NAME_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"
PROXY_ID_PATTERN = r"^[a-z][a-z0-9_-]{0,63}$"
TCP_PREFIX = "tcp://"
# A route's string argument; the API takes call bodies of up to 96 KiB
MAX_ROUTE_STRING = 32 * 1024
TOKEN = re.compile(r"\$\{(arg|secret):([a-z][a-z0-9_]{0,63})\}")
_HEADER_NAME = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}")
_PRINTABLE = re.compile(r"[\x20-\x7e]*")

# What a proxy's response may be, by its media type
ACCEPTED_TYPES = ("application/json", "text/plain", "text/csv", "text/markdown", "text/html", "application/xml")
MAX_BYTES = 25 * 1024 * 1024
MAX_TIMEOUT_MS = 30_000

# Headers the API sets or that would let a template change how the request travels
FORBIDDEN_HEADERS = frozenset(
    {
        "host",
        "accept-encoding",
        "content-length",
        "content-type",
        "transfer-encoding",
        "connection",
        "keep-alive",
        "upgrade",
        "te",
        "trailer",
        "proxy-authorization",
        "proxy-connection",
        "cookie",
        "expect",
        "forwarded",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-real-ip",
    }
)


class _Closed(PydanticBaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


Scalar = str | int | float | bool


class ProxyArg(_Closed):
    """One argument a call gives: a string, a number, a boolean or one of fixed values."""

    type: Literal["string", "number", "boolean", "enum"]
    maxLength: int = Field(default=256, ge=1, le=2048)  # noqa: N815
    minimum: float | None = None
    maximum: float | None = None
    values: list[Scalar] | None = Field(default=None, min_length=1, max_length=100)
    required: bool = False


class RouteArg(ProxyArg):
    """An argument of a backend route: as a proxy's, but it travels in a JSON body rather
    than a URL, so a string may be longer (a query a user writes, for example)."""

    maxLength: int = Field(default=256, ge=1, le=MAX_ROUTE_STRING)  # noqa: N815


class ProxyResponse(_Closed):
    accepts: list[Literal[ACCEPTED_TYPES]] = Field(default_factory=lambda: ["application/json"], min_length=1)  # type: ignore[valid-type]
    maxBytes: int = Field(default=1024 * 1024, ge=1, le=MAX_BYTES)  # noqa: N815
    timeoutMs: int = Field(default=10_000, ge=100, le=MAX_TIMEOUT_MS)  # noqa: N815


class Proxy(_Closed):
    id: Annotated[str, StringConstraints(pattern=PROXY_ID_PATTERN)]
    method: Literal["GET", "POST"] = "GET"
    url: Annotated[str, StringConstraints(min_length=1, max_length=2048)]
    query: dict[
        Annotated[str, StringConstraints(min_length=1, max_length=128)],
        Annotated[str, StringConstraints(max_length=2048)],
    ] = Field(default_factory=dict, max_length=32)
    headers: dict[str, Annotated[str, StringConstraints(max_length=2048)]] = Field(default_factory=dict, max_length=16)
    body: dict[Annotated[str, StringConstraints(min_length=1, max_length=128)], Scalar | None] | None = Field(
        default=None, max_length=32
    )
    args: dict[Annotated[str, StringConstraints(pattern=NAME_PATTERN)], ProxyArg] = Field(
        default_factory=dict, max_length=32
    )
    response: ProxyResponse = Field(default_factory=ProxyResponse)


# ---------------------------------------------------------------------------
# What a manifest may declare
# ---------------------------------------------------------------------------


def check_network(
    network: list[str], *, confirmations: set[str] | None = None, override: bool = False, backend: bool = False
) -> csp_rules.PolicyCheck:
    """``server.network``: https origins, with the CSP's host rules (SERVER-SIDE 6), and,
    for a plugin with a backend, ``tcp://host:port`` endpoints such as a database. An
    author cannot ask for a private host; a superuser's override can, with ``private-host``."""
    check = csp_rules.PolicyCheck()
    for source in network:
        if isinstance(source, str) and source.startswith(TCP_PREFIX):
            _check_tcp(source, check, backend=backend)
            continue
        csp_rules.check_source("connect-src", source, check)
        if isinstance(source, str) and not re.fullmatch(r"https://[^/?#]+", source):
            check.errors.append(f"server.network: {source!r} is not an https origin")
    if check.needs and not override:
        check.errors.append("server.network: a private host or an IP address needs a superuser's override")
    elif override:
        missing = check.needs - (confirmations or set())
        if missing:
            check.errors.append(f"server.network: confirm {', '.join(sorted(missing))}")
    return check


def _check_tcp(source: str, check: csp_rules.PolicyCheck, *, backend: bool) -> None:
    """A ``tcp://host:port`` endpoint: only a backend opens one, the port is named, and
    the host follows the rules of an https origin, without a wildcard."""
    if not backend:
        check.errors.append(f"server.network: {source!r} is for a plugin backend, and this plugin declares none")
        return
    if not re.fullmatch(r"tcp://[^/?#*:]+:\d{1,5}", source):
        check.errors.append(f"server.network: {source!r} is not tcp://host:port")
        return
    csp_rules.check_source("connect-src", "https://" + source.removeprefix(TCP_PREFIX), check)


def host_allowed(host: str, port: int, network: list[str]) -> bool:
    """Whether ``host:port`` is an https origin of the approved list (a ``*.`` wildcard
    covers the names under it, not itself). ``tcp://`` endpoints are a backend's, never
    the API's."""
    for source in network:
        parts = urlsplit(source)
        if parts.scheme != "https":
            continue
        allowed_host = (parts.hostname or "").lower()
        allowed_port = parts.port or HTTPS_PORT
        if allowed_port != port:
            continue
        if allowed_host.startswith("*."):
            if host.endswith(allowed_host[1:]) and host != allowed_host[2:]:
                return True
        elif host == allowed_host:
            return True
    return False


def _tokens(text: str) -> list[tuple[str, str]]:
    return [(m[1], m[2]) for m in TOKEN.finditer(text)]


def _stray(text: str) -> bool:
    """Whether ``${`` appears outside a valid token."""
    return "${" in TOKEN.sub("", text)


def _url_problems(proxy: Proxy, network: list[str], where: str) -> list[str]:
    """The URL is a literal https origin on the approved list; arguments go in the path."""
    errors: list[str] = []
    head = proxy.url.partition("${")[0]
    parts = urlsplit(proxy.url)
    if parts.scheme != "https":
        errors.append(f"{where}.url: only https is allowed")
    if "?" in proxy.url or "#" in proxy.url:
        errors.append(f"{where}.url: no query or fragment; put query values in query")
    if "@" in parts.netloc:
        errors.append(f"{where}.url: no credentials in the URL")
    # Everything before the first token is the origin and the start of the path
    if "${" in parts.netloc or ("${" in proxy.url and not urlsplit(head).path.startswith("/")):
        errors.append(f"{where}.url: the scheme, host and port are literals")
        return errors
    try:
        host, port = (parts.hostname or "").lower(), parts.port or HTTPS_PORT
    except ValueError:
        return [*errors, f"{where}.url: the port is not valid"]
    if parts.scheme == "https" and host and not host_allowed(host, port, network):
        errors.append(f"{where}.url: {host} is not on server.network")
    return errors


def _arg_problems(proxy: Proxy, where: str) -> list[str]:
    errors: list[str] = []
    for name, spec in proxy.args.items():
        if spec.type == "enum" and not spec.values:
            errors.append(f"{where}.args.{name}: an enum lists its values")
        if spec.type != "enum" and spec.values is not None:
            errors.append(f"{where}.args.{name}: values are for an enum")
        if spec.type != "number" and (spec.minimum is not None or spec.maximum is not None):
            errors.append(f"{where}.args.{name}: minimum and maximum are for a number")
    return errors


def check_proxy(proxy: Proxy, network: list[str], secrets: set[str]) -> list[str]:
    """The template rules of SERVER-SIDE 3.2: where arguments and secrets may go."""
    where = f"server.proxies[{proxy.id}]"
    errors = _url_problems(proxy, network, where)

    def tokens_in(part: str, text: str, allowed: set[str]) -> None:
        if _stray(text):
            errors.append(f"{where}.{part}: only ${{arg:<name>}} and ${{secret:<name>}} are substituted")
        for kind, name in _tokens(text):
            if kind not in allowed:
                errors.append(f"{where}.{part}: ${{{kind}:{name}}} may not appear here")
            elif kind == "arg" and name not in proxy.args:
                errors.append(f"{where}.{part}: ${{arg:{name}}} is not a declared argument")
            elif kind == "secret" and name not in secrets:
                errors.append(f"{where}.{part}: ${{secret:{name}}} is not a declared secret")

    tokens_in("url", urlsplit(proxy.url).path, {"arg"})
    for name, value in proxy.query.items():
        if "${" in name:
            errors.append(f"{where}.query: a name is a literal")
        tokens_in(f"query.{name}", value, {"arg"})
    for name, value in proxy.headers.items():
        lower = name.lower()
        if not _HEADER_NAME.fullmatch(name) or lower in FORBIDDEN_HEADERS or lower.startswith(("sec-", "proxy-")):
            errors.append(f"{where}.headers: {name!r} cannot be set")
        if not _PRINTABLE.fullmatch(value):
            errors.append(f"{where}.headers.{name}: printable ASCII only")
        tokens_in(f"headers.{name}", value, {"secret"})
    if proxy.body is not None:
        if proxy.method != "POST":
            errors.append(f"{where}.body: a body needs the method POST")
        for name, value in proxy.body.items():
            if "${" in name:
                errors.append(f"{where}.body: a field name is a literal")
            if isinstance(value, str):
                tokens_in(f"body.{name}", value, {"arg"})
    return errors + _arg_problems(proxy, where)


# ---------------------------------------------------------------------------
# A call
# ---------------------------------------------------------------------------


class CallError(Exception):
    """Why a call was not made or failed; ``code`` is stable, ``message`` safe to show.
    ``upstream`` is the upstream's status when it answered."""

    def __init__(self, code: str, message: str, status: int = 422, upstream: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.upstream = upstream


@dataclass(frozen=True)
class BuiltCall:
    method: str
    url: str
    headers: dict[str, str]
    body: bytes | None


def check_args(specs: dict[str, ProxyArg], args: dict[str, Any]) -> dict[str, Any]:
    """A call's arguments against their declared types (a proxy's or a backend route's).
    Unknown ones are refused."""
    unknown = sorted(set(args) - set(specs))
    if unknown:
        raise CallError("invalid_args", f"unknown arguments: {', '.join(unknown)}")
    checked: dict[str, Any] = {}
    for name, spec in specs.items():
        value = args.get(name)
        if value is None:
            if spec.required:
                raise CallError("invalid_args", f"{name} is required")
            continue
        if spec.type == "string":
            if not isinstance(value, str) or len(value) > spec.maxLength:
                raise CallError("invalid_args", f"{name} is a string of at most {spec.maxLength} characters")
        elif spec.type == "number":
            if isinstance(value, bool) or not isinstance(value, int | float):
                raise CallError("invalid_args", f"{name} is a number")
            if (spec.minimum is not None and value < spec.minimum) or (spec.maximum is not None and value > spec.maximum):
                raise CallError("invalid_args", f"{name} is out of range")
        elif spec.type == "boolean":
            if not isinstance(value, bool):
                raise CallError("invalid_args", f"{name} is true or false")
        # An enum value matches with its type too, so true is not 1
        elif not any(value == v and type(value) is type(v) for v in spec.values or []):
            raise CallError("invalid_args", f"{name} is one of its declared values")
        checked[name] = value
    return checked


def _text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _fill(template: str, args: dict[str, Any], secrets: dict[str, str], *, encode: bool) -> str | None:
    """The template with its tokens replaced; None when an argument it needs is absent."""
    missing = False

    def replace(match: re.Match[str]) -> str:
        nonlocal missing
        kind, name = match[1], match[2]
        if kind == "secret":
            if name not in secrets:
                raise CallError("secret_missing", f"the secret {name} is not set", status=409)
            return secrets[name]
        if name not in args:
            missing = True
            return ""
        text = _text(args[name])
        return quote(text, safe="") if encode else text

    filled = TOKEN.sub(replace, template)
    return None if missing else filled


def build_call(proxy: Proxy, args: dict[str, Any], secrets: dict[str, str]) -> BuiltCall:
    """The request a call makes. A path argument is required; a query value or a body field
    whose argument is absent is left out; a body field that is one argument keeps its type."""
    checked = check_args(proxy.args, args)
    url = _fill(proxy.url, checked, {}, encode=True)
    if url is None:
        raise CallError("invalid_args", "an argument of the path is missing")
    query = {
        name: value
        for name, template in proxy.query.items()
        if (value := _fill(template, checked, {}, encode=False)) is not None
    }
    if query:
        url = f"{url}?{urlencode(query)}"
    headers = {
        name: filled
        for name, template in proxy.headers.items()
        if (filled := _fill(template, {}, secrets, encode=False)) is not None
    }
    # The size cap counts the bytes received, so the answer is not compressed
    headers["Accept-Encoding"] = "identity"
    body: bytes | None = None
    if proxy.body is not None:
        fields: dict[str, Any] = {}
        for name, template in proxy.body.items():
            if not isinstance(template, str):
                fields[name] = template
                continue
            whole = TOKEN.fullmatch(template)
            if whole and whole[1] == "arg":
                if whole[2] in checked:
                    fields[name] = checked[whole[2]]
                continue
            filled = _fill(template, checked, {}, encode=False)
            if filled is not None:
                fields[name] = filled
        body = json.dumps(fields).encode()
        headers["Content-Type"] = "application/json"
    return BuiltCall(method=proxy.method, url=url, headers=headers, body=body)


def _tls(ca_file: str | None) -> ssl.SSLContext:
    """The system's certificate authorities, plus the deployment's own when it has one."""
    context = ssl.create_default_context()
    if ca_file:
        context.load_verify_locations(cafile=ca_file)
    return context


@dataclass(frozen=True)
class ProxyResult:
    content_type: str
    body: Any
    status: int
    size: int
    duration_ms: int


async def _send(
    request: httpx.Request, *, ca_file: str | None, timeout: float, limit: int
) -> tuple[httpx.Response, bytes]:
    """Send the request, reading at most ``limit`` bytes of the answer."""
    try:
        async with httpx.AsyncClient(verify=_tls(ca_file), follow_redirects=False, timeout=timeout) as client:
            response = await client.send(request, stream=True)
            try:
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_raw():
                    size += len(chunk)
                    if size > limit:
                        message = f"the response is larger than {limit} bytes"
                        raise CallError("response_too_large", message, status=502)
                    chunks.append(chunk)
            finally:
                await response.aclose()
    except httpx.TimeoutException as error:
        raise CallError("timeout", "the upstream did not answer in time", status=504) from error
    except httpx.HTTPError as error:
        raise CallError("upstream_unreachable", "the upstream could not be reached", status=502) from error
    return response, b"".join(chunks)


def _decode(proxy: Proxy, response: httpx.Response, raw: bytes) -> tuple[str, Any]:
    """The answer as JSON or text, when it is a success of a type the proxy accepts. Of the
    upstream's headers only the type is kept, and of a failure only its class."""
    upstream = response.status_code
    if not 200 <= upstream < 300:  # noqa: PLR2004
        raise CallError("upstream_error", f"the upstream answered {upstream // 100}xx", 502, upstream)
    if response.headers.get("content-encoding", "identity").strip().lower() != "identity":
        raise CallError("upstream_error", "the upstream answered compressed", 502, upstream)
    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in proxy.response.accepts:
        message = f"the upstream answered {content_type or 'no type'}"
        raise CallError("unsupported_content_type", message, 502, upstream)
    try:
        text = raw.decode(response.charset_encoding or "utf-8")
        return content_type, json.loads(text) if content_type == "application/json" else text
    except (UnicodeDecodeError, LookupError, json.JSONDecodeError) as error:
        raise CallError("upstream_error", "the upstream's answer could not be read", 502, upstream) from error


async def call(  # noqa: PLR0913 - the limits come from the manifest and the deployment
    proxy: Proxy,
    args: dict[str, Any],
    secrets: dict[str, str],
    *,
    network: list[str],
    allow_private: bool,
    max_bytes: int,
    timeout_ms: int,
    ca_file: str | None = None,
) -> ProxyResult:
    """Make the call (SERVER-SIDE 3.3): build it, check where it goes, send it to the
    checked address, and read at most ``max_bytes`` within ``timeout_ms``."""
    built = build_call(proxy, args, secrets)
    parts = urlsplit(built.url)
    host = (parts.hostname or "").lower()
    if not host_allowed(host, parts.port or HTTPS_PORT, network):
        raise CallError("egress_refused", f"{host} is not on the approved list", status=403)
    try:
        destination: Destination = await check_destination(built.url, allow_private=allow_private)
    except EgressRefused as error:
        raise CallError("egress_refused", str(error), status=403) from error

    request = pinned_request(built.method, built.url, destination, headers=built.headers, content=built.body)
    started = time.monotonic()
    response, raw = await _send(
        request,
        ca_file=ca_file,
        timeout=min(proxy.response.timeoutMs, timeout_ms) / 1000,
        limit=min(proxy.response.maxBytes, max_bytes),
    )
    duration_ms = int((time.monotonic() - started) * 1000)
    content_type, body = _decode(proxy, response, raw)
    return ProxyResult(
        content_type=content_type, body=body, status=response.status_code, size=len(raw), duration_ms=duration_ms
    )
