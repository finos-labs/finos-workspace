import asyncio
import base64
import ipaddress
import json
import secrets
import socket
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta
from http.cookiejar import CookieJar, DefaultCookiePolicy
from typing import Annotated, Any, override
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from uuid import UUID

import httpcore
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from loguru import logger
from mcp.client.auth import OAuthFlowError, OAuthTokenError, PKCEParameters
from mcp.client.auth.oauth2 import check_registration_usable
from mcp.client.auth.utils import (
    build_oauth_authorization_server_metadata_discovery_urls,
    build_protected_resource_metadata_discovery_urls,
    extract_resource_metadata_from_www_auth,
    extract_scope_from_www_auth,
    get_client_metadata_scopes,
    issuers_match,
    validate_metadata_issuer,
)
from mcp.shared.auth import (
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthMetadata,
    OAuthToken,
    ProtectedResourceMetadata,
)
from mcp.shared.auth_utils import check_resource_allowed, resource_url_from_server_url
from mcp.types import LATEST_PROTOCOL_VERSION
from pydantic import ValidationError
from redis.exceptions import LockError
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, crypto, database, models, schemas
from api.database import aget_write_db
from api.rate_limit import LIMIT_DEFAULT, limiter
from utilities.config import settings

router = APIRouter(
    prefix="/app/mcp-oauth",
    tags=["app"],
)

_NAT64 = ipaddress.ip_network("64:ff9b::/96")


class BlockedAddressError(Exception):
    ...


def is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        elif ip in _NAT64:
            ip = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return ip.is_global and not ip.is_multicast


def may_reach_any_address(host: str, port: int) -> bool:
    host = host.lower()
    if host in {name.lower() for name in settings.ALLOWED_MCP_HOSTNAMES}:
        return True
    return (host, port) in {_host_and_port(server.url) for server in settings.DEFAULT_MCP_SERVERS}


def _host_and_port(url: str) -> tuple[str, int]:
    parts = urlsplit(url)
    return (parts.hostname or "").lower(), parts.port or (443 if parts.scheme == "https" else 80)


async def resolve_host(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(
        host, port, type=socket.SOCK_STREAM
    )
    return [str(info[4][0]) for info in infos]


async def public_address(host: str, port: int) -> str:
    try:
        addresses = await resolve_host(host, port)
    except OSError as exc:
        raise httpcore.ConnectError(f"{host} could not be resolved") from exc
    if not addresses:
        raise httpcore.ConnectError(f"{host} could not be resolved")
    if not all(is_public_address(address) for address in addresses):
        raise BlockedAddressError(f"{host} is not on the public internet")
    return addresses[0]


class _PublicNetwork(httpcore.AsyncNetworkBackend):
    def __init__(self, network: httpcore.AsyncNetworkBackend):
        self._network = network

    @override
    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Any = None,
    ) -> httpcore.AsyncNetworkStream:
        address = (
            host if may_reach_any_address(host, port) else await public_address(host, port)
        )
        return await self._network.connect_tcp(
            address,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    @override
    async def connect_unix_socket(
        self, path: str, timeout: float | None = None, socket_options: Any = None
    ) -> httpcore.AsyncNetworkStream:
        raise BlockedAddressError("Unix sockets may not be reached")

    @override
    async def sleep(self, seconds: float) -> None:
        await self._network.sleep(seconds)


class PublicAddressTransport(httpx.AsyncHTTPTransport):
    def __init__(self, network: httpcore.AsyncNetworkBackend | None = None):
        super().__init__()
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(),
            max_connections=100,
            max_keepalive_connections=20,
            keepalive_expiry=5.0,
            network_backend=_PublicNetwork(network or httpcore.AnyIOBackend()),
        )


def create_mcp_http_client(
    network: httpcore.AsyncNetworkBackend | None = None,
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=PublicAddressTransport(network),
        timeout=httpx.Timeout(10.0, read=300.0, connect=5.0),
        follow_redirects=False,
        trust_env=False,
        cookies=CookieJar(DefaultCookiePolicy(allowed_domains=[])),
    )


mcp_http = create_mcp_http_client()

CALLBACK_PATH = "/oauth/callback"
CLIENT_NAME = "FINOS Workspace"
GRANT_TYPES = ["authorization_code", "refresh_token"]
STATE_LIFETIME = timedelta(minutes=10)
REFRESH_LOCK_SECONDS = 30
EXPIRY_MARGIN_SECONDS = 60
OAUTH_TIMEOUT = httpx.Timeout(10.0)
MAX_ANSWER_BYTES = 256 * 1024
_METADATA_HEADERS = {
    "Accept": "application/json",
    "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
}
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


class TokenEndpointError(OAuthTokenError):
    def __init__(self, status_code: int, error: str | None):
        super().__init__(f"the authorization server refused it ({error or status_code})")
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class _SignIn:
    metadata: OAuthMetadata
    client: OAuthClientInformationFull
    resource: str
    scope: str | None


async def web_user(
    request: Request,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    if request.headers.get(auth_helpers.CLIENT_HEADER) != auth_helpers.WEB_CLIENT:
        raise auth_helpers.credentials_exception
    return user


def _callback_uri(request: Request) -> str:
    return f"{request.headers['Origin']}{CALLBACK_PATH}"


async def _fetch(method: str, url: str, **kwargs: Any) -> tuple[httpx.Response, bytes]:
    request = mcp_http.build_request(method, url, timeout=OAUTH_TIMEOUT, **kwargs)
    response = await mcp_http.send(request, stream=True)
    body = bytearray()
    try:
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > MAX_ANSWER_BYTES:
                raise OAuthFlowError("a metadata or token request answered with too much data")
    finally:
        await response.aclose()
    return response, bytes(body)


async def _challenge(server: str) -> httpx.Response:
    request = mcp_http.build_request(
        "POST",
        server,
        json={"jsonrpc": "2.0", "id": 0, "method": "ping"},
        headers={**_METADATA_HEADERS, "Accept": "application/json, text/event-stream"},
        timeout=OAUTH_TIMEOUT,
    )
    response = await mcp_http.send(request, stream=True)
    await response.aclose()
    return response


async def _protected_resource(
    server: str, challenge: httpx.Response
) -> ProtectedResourceMetadata | None:
    failed: int | None = None
    urls = build_protected_resource_metadata_discovery_urls(
        extract_resource_metadata_from_www_auth(challenge), server
    )
    for url in urls:
        response, body = await _fetch("GET", url, headers=_METADATA_HEADERS)
        if response.status_code == status.HTTP_200_OK:
            try:
                metadata = ProtectedResourceMetadata.model_validate_json(body)
            except ValidationError:
                continue
            if not check_resource_allowed(
                requested_resource=resource_url_from_server_url(server),
                configured_resource=str(metadata.resource),
            ):
                raise OAuthFlowError("its metadata describes another resource")
            return metadata
        if (
            httpx.codes.is_server_error(response.status_code)
            or response.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        ):
            failed = response.status_code
    if failed is not None:
        raise OAuthFlowError(f"its resource metadata could not be read (HTTP {failed})")
    return None


async def _authorization_server(
    server: str, resource: ProtectedResourceMetadata | None
) -> OAuthMetadata:
    authorization_server = str(resource.authorization_servers[0]) if resource else None
    parts = urlsplit(server)
    expected_issuer = authorization_server or f"{parts.scheme}://{parts.netloc}"
    urls = build_oauth_authorization_server_metadata_discovery_urls(
        authorization_server, server
    )
    for url in urls:
        response, body = await _fetch("GET", url, headers=_METADATA_HEADERS)
        if httpx.codes.is_server_error(response.status_code):
            break
        if response.status_code != status.HTTP_200_OK:
            continue
        try:
            metadata = OAuthMetadata.model_validate_json(body)
        except ValidationError:
            continue
        if authorization_server is None and issuers_match(
            str(metadata.issuer), expected_issuer
        ):
            expected_issuer = str(metadata.issuer)
        validate_metadata_issuer(metadata, expected_issuer)
        return metadata
    if authorization_server is not None:
        raise OAuthFlowError("its authorization server publishes no metadata")
    return OAuthMetadata(
        issuer=expected_issuer,
        authorization_endpoint=f"{expected_issuer}/authorize",
        token_endpoint=f"{expected_issuer}/token",
        registration_endpoint=f"{expected_issuer}/register",
    )


async def _register(
    metadata: OAuthMetadata, redirect_uri: str, scope: str | None
) -> OAuthClientInformationFull:
    if metadata.registration_endpoint is None:
        raise OAuthFlowError("its authorization server does not register clients")
    loopback = urlsplit(redirect_uri).hostname in _LOOPBACK_HOSTS
    client = OAuthClientMetadata(
        redirect_uris=[redirect_uri],
        client_name=CLIENT_NAME,
        grant_types=GRANT_TYPES,
        scope=scope,
        application_type="native" if loopback else "web",
    )
    response, body = await _fetch(
        "POST",
        str(metadata.registration_endpoint),
        json=client.model_dump(by_alias=True, mode="json", exclude_none=True),
        headers={"Accept": "application/json"},
    )
    if response.status_code not in {status.HTTP_200_OK, status.HTTP_201_CREATED}:
        raise OAuthFlowError(f"its client registration failed (HTTP {response.status_code})")
    registration = json.loads(body)
    if isinstance(registration, dict):
        registration.pop("issuer", None)
    registered = OAuthClientInformationFull.model_validate(registration)
    check_registration_usable(registered)
    return registered


async def _prepare(server: str, redirect_uri: str) -> _SignIn:
    challenge = await _challenge(server)
    resource = await _protected_resource(server, challenge)
    metadata = await _authorization_server(server, resource)
    if metadata.code_challenge_methods_supported is not None and (
        "S256" not in metadata.code_challenge_methods_supported
    ):
        raise OAuthFlowError("its authorization server does not support PKCE with S256")
    scope = get_client_metadata_scopes(
        extract_scope_from_www_auth(challenge), resource, metadata, GRANT_TYPES
    )
    return _SignIn(
        metadata=metadata,
        client=await _register(metadata, redirect_uri, scope),
        resource=str(resource.resource) if resource else resource_url_from_server_url(server),
        scope=scope,
    )


def _authorization_url(
    sign_in: _SignIn, redirect_uri: str, state: str, pkce: PKCEParameters
) -> str:
    params = {
        "response_type": "code",
        "client_id": sign_in.client.client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": pkce.code_challenge,
        "code_challenge_method": "S256",
        "resource": sign_in.resource,
    }
    if sign_in.scope:
        params["scope"] = sign_in.scope
        if "offline_access" in sign_in.scope.split():
            params["prompt"] = "consent"
    endpoint = urlsplit(str(sign_in.metadata.authorization_endpoint))
    if endpoint.scheme not in {"http", "https"}:
        raise OAuthFlowError("its sign-in page is not a web page")
    query = urlencode([*parse_qsl(endpoint.query), *params.items()])
    return urlunsplit(endpoint._replace(query=query, fragment=""))


def _oauth_error(body: bytes) -> str | None:
    try:
        error = json.loads(body).get("error")
    except (ValueError, AttributeError):
        return None
    return error[:100] if isinstance(error, str) else None


async def _token_request(
    endpoint: str, client: OAuthClientInformationFull, form: dict[str, str]
) -> OAuthToken:
    headers = {"Accept": "application/json"}
    form = {**form, "client_id": client.client_id}
    method = client.token_endpoint_auth_method
    if client.client_secret and method == "client_secret_basic":
        pair = f"{quote(client.client_id, safe='')}:{quote(client.client_secret, safe='')}"
        headers["Authorization"] = "Basic " + base64.b64encode(pair.encode()).decode()
    elif client.client_secret and method == "client_secret_post":
        form["client_secret"] = client.client_secret
    response, body = await _fetch("POST", endpoint, data=form, headers=headers)
    if response.status_code != status.HTTP_200_OK:
        raise TokenEndpointError(response.status_code, _oauth_error(body))
    return OAuthToken.model_validate_json(body)


def _credentials(
    user_uuid: UUID,
    server: str,
    token: OAuthToken,
    client: OAuthClientInformationFull,
    token_endpoint: str,
    resource: str,
) -> dict[str, Any]:
    return {
        "user_uuid": str(user_uuid),
        "server_url": server,
        "token": token.model_dump(mode="json", exclude_none=True),
        "expires_at": time.time() + token.expires_in if token.expires_in else None,
        "client": client.model_dump(mode="json", exclude_none=True),
        "token_endpoint": token_endpoint,
        "resource": resource,
    }


@asynccontextmanager
async def _outbound(action: str) -> AsyncIterator[None]:
    try:
        yield
    except BlockedAddressError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=f"Could not {action}: {exc}"
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Could not {action}: the server did not answer in time",
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        logger.info(f"MCP sign-in: could not {action}: {type(exc).__name__}")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not {action}: the server's answer could not be used",
        ) from exc
    except OAuthFlowError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=f"Could not {action}: {exc}"
        ) from exc


def _state_key(state: str) -> str:
    return auth_helpers.app_redis_key(f"mcp_oauth_state:{crypto.hash_token(state)}")


def _refresh_lock_key(user_uuid: UUID, server: str) -> str:
    return auth_helpers.app_redis_key(
        f"mcp_oauth_refresh:{user_uuid}:{crypto.hash_token(server)}"
    )


async def _keep_state(state: str, record: dict[str, Any]) -> None:
    key = _state_key(state)
    async with auth_helpers.app_redis() as redis:
        await redis.set(
            key,
            crypto.encrypt_json(record, key),
            ex=int(STATE_LIFETIME.total_seconds()),
        )


async def _take_state(state: str) -> dict[str, Any] | None:
    key = _state_key(state)
    async with auth_helpers.app_redis() as redis:
        sealed = await redis.getdel(key)
    if sealed is None:
        return None
    try:
        return crypto.decrypt_json(
            sealed.decode() if isinstance(sealed, bytes) else sealed, key
        )
    except crypto.DecryptionError:
        return None


def server_hash(server: str) -> str:
    return crypto.hash_token(server)


def _grant_filter(user_uuid: UUID, server: str):
    return (
        models.MCPOAuthGrant.user_uuid == user_uuid,
        models.MCPOAuthGrant.server_hash == server_hash(server),
    )


async def _load_grant(db: AsyncSession, user_uuid: UUID, server: str) -> dict | None:
    query = select(models.MCPOAuthGrant.credentials).where(*_grant_filter(user_uuid, server))
    credentials = (await db.execute(query)).scalar_one_or_none()
    if credentials is None:
        return None
    if credentials.get("user_uuid") != str(user_uuid) or credentials.get("server_url") != server:
        logger.warning("MCP sign-in: a grant's content is not its row's; it is not used")
        return None
    return credentials


def _bearer(credentials: dict) -> str:
    return f"Bearer {credentials['token']['access_token']}"


def _expired(credentials: dict) -> bool:
    expires_at = credentials.get("expires_at")
    return expires_at is not None and time.time() >= expires_at - EXPIRY_MARGIN_SECONDS


async def _refreshed(db: AsyncSession, user_uuid: UUID, server: str) -> dict | None:
    credentials = await _load_grant(db, user_uuid, server)
    if credentials is None:
        return None
    token = OAuthToken.model_validate(credentials["token"])
    client = OAuthClientInformationFull.model_validate(credentials["client"])
    fresh = None
    if token.refresh_token is not None:
        form = {
            "grant_type": "refresh_token",
            "refresh_token": token.refresh_token,
            "resource": credentials["resource"],
        }
        try:
            fresh = await _token_request(credentials["token_endpoint"], client, form)
        except TokenEndpointError as exc:
            if httpx.codes.is_server_error(exc.status_code) or exc.status_code in {
                status.HTTP_408_REQUEST_TIMEOUT,
                status.HTTP_429_TOO_MANY_REQUESTS,
            }:
                return None
        except (httpx.HTTPError, OAuthFlowError, BlockedAddressError, ValueError) as exc:
            logger.info(f"MCP sign-in: refreshing a token failed: {type(exc).__name__}")
            return None
    if fresh is None:
        await db.execute(delete(models.MCPOAuthGrant).where(*_grant_filter(user_uuid, server)))
        await db.commit()
        return None
    fresh.scope = fresh.scope or token.scope
    fresh.refresh_token = fresh.refresh_token or token.refresh_token
    credentials = _credentials(
        user_uuid, server, fresh, client, credentials["token_endpoint"], credentials["resource"]
    )
    await db.execute(
        update(models.MCPOAuthGrant)
        .where(*_grant_filter(user_uuid, server))
        .values(credentials=credentials)
    )
    await db.commit()
    return credentials


async def grant_authorization(
    user_uuid: UUID, server: str, *, refused: str | None = None
) -> str | None:
    async with database.AsyncWriteSessionLocal.session() as db:
        credentials = await _load_grant(db, user_uuid, server)
    if credentials is None:
        return None
    header = _bearer(credentials)
    if header != refused and not _expired(credentials):
        return header

    try:
        async with (
            auth_helpers.app_redis() as redis,
            redis.lock(
                _refresh_lock_key(user_uuid, server),
                timeout=REFRESH_LOCK_SECONDS,
                blocking_timeout=REFRESH_LOCK_SECONDS,
            ),
            database.AsyncWriteSessionLocal.session() as db,
        ):
            current = await _load_grant(db, user_uuid, server)
            if current is not None and _bearer(current) != header and not _expired(current):
                return _bearer(current)
            credentials = await _refreshed(db, user_uuid, server)
    except LockError:
        logger.warning("MCP sign-in: a token refresh did not get the lock")
        return None
    return _bearer(credentials) if credentials else None


@router.post(
    "/start",
    response_model=schemas.MCPOAuthAuthorization,
    summary="Start signing in to an MCP server",
    description=(
        "Finds the authorization server of the MCP server in the request, registers FINOS Workspace as its client when "
        "the server needs that, and returns the address at which the user grants access. The API remembers the attempt "
        "for the user's session. Only the web app can call it, so the request must carry the header "
        "`X-Workspace-Client: web`."
    ),
)
@limiter.limit(LIMIT_DEFAULT)
async def start_mcp_oauth(
    request: Request,
    payload: schemas.MCPOAuthServer,
    user=Depends(web_user),
):
    redirect_uri = _callback_uri(request)
    async with _outbound("prepare the sign-in"):
        sign_in = await _prepare(payload.server_url, redirect_uri)
        pkce = PKCEParameters.generate()
        state = secrets.token_urlsafe(32)
        authorization_url = _authorization_url(sign_in, redirect_uri, state, pkce)
    await _keep_state(
        state,
        {
            "user_uuid": str(user.uuid),
            "session_uuid": str(user.session_uuid),
            "server_url": payload.server_url,
            "redirect_uri": redirect_uri,
            "code_verifier": pkce.code_verifier,
            "client": sign_in.client.model_dump(mode="json", exclude_none=True),
            "token_endpoint": str(sign_in.metadata.token_endpoint),
            "resource": sign_in.resource,
            "scope": sign_in.scope,
        },
    )
    return schemas.MCPOAuthAuthorization(authorization_url=authorization_url)


@router.post(
    "/complete",
    response_model=schemas.MCPOAuthCompleted,
    summary="Finish signing in to an MCP server",
    description=(
        "Exchanges the authorization code that the MCP server's authorization server returned for tokens, and stores "
        "them as the user's grant for that server, replacing an earlier grant. Answers 400 when the attempt has "
        "expired, was not started by this user and session, or came back to another address. Only the web app can call "
        "it."
    ),
)
@limiter.limit(LIMIT_DEFAULT)
async def complete_mcp_oauth(
    request: Request,
    payload: schemas.MCPOAuthCallback,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(web_user),
):
    record = await _take_state(payload.state)
    if (
        record is None
        or record["user_uuid"] != str(user.uuid)
        or record["session_uuid"] != str(user.session_uuid)
        or record["redirect_uri"] != _callback_uri(request)
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="This sign-in has expired or was not started here. Sign in again.",
        )
    client = OAuthClientInformationFull.model_validate(record["client"])
    form = {
        "grant_type": "authorization_code",
        "code": payload.code,
        "redirect_uri": record["redirect_uri"],
        "code_verifier": record["code_verifier"],
        "resource": record["resource"],
    }
    async with _outbound("complete the sign-in"):
        token = await _token_request(record["token_endpoint"], client, form)
    token.scope = token.scope or record["scope"]

    server = record["server_url"]
    await db.execute(delete(models.MCPOAuthGrant).where(*_grant_filter(user.uuid, server)))
    await db.execute(
        insert(models.MCPOAuthGrant).values(
            user_uuid=user.uuid,
            server_hash=server_hash(server),
            credentials=_credentials(
                user.uuid, server, token, client, record["token_endpoint"], record["resource"]
            ),
        )
    )
    await db.commit()
    return schemas.MCPOAuthCompleted(server_url=server)


@router.post(
    "/disconnect",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Disconnect from an MCP server",
    description=(
        "Deletes the user's grant for the MCP server in the request, so that the Copilot can no longer use the user's "
        "sign-in there. Only the web app can call it."
    ),
)
async def disconnect_mcp_oauth(
    payload: schemas.MCPOAuthServer,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(web_user),
):
    await db.execute(
        delete(models.MCPOAuthGrant).where(*_grant_filter(user.uuid, payload.server_url))
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
