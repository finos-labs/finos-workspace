import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import timedelta
from http import HTTPStatus
from time import monotonic
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import HTTPException, Request, Response
from jwt import PyJWTError

from utilities.config import settings

from . import auth_helpers, crypto

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
MICROSOFT_AUTHORITY = "https://login.microsoftonline.com"
MICROSOFT_TENANT_TEMPLATE = "{tenantid}"
MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"

ID_TOKEN_ALGORITHMS = ["RS256"]
LEEWAY_SECONDS = 60
DOCUMENT_CACHE_SECONDS = 3600
DOCUMENT_REFRESH_SECONDS = 300

SIGN_IN_COOKIE = "__Host-ws_signin"
SIGN_IN_LIFETIME = timedelta(minutes=10)
SIGN_IN_PROVIDERS = ("microsoft", "okta")
CALLBACK_ROUTE = "/app/sign-in/{provider}/callback"
BASE_SCOPE = "openid profile email"
VERIFIER_CONTEXT = "sign_in_state.verifier"
REVOKED_ERRORS = frozenset({"invalid_grant", "interaction_required"})

_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
_documents: dict[str, tuple[float, dict[str, Any]]] = {}


class TokenRevoked(Exception):
    pass


@dataclass(frozen=True, slots=True)
class SignInIdentity:
    email: str
    email_verified: bool
    given_name: str | None = None
    family_name: str | None = None
    microsoft_id: str | None = None
    expires_at: int | None = None


@dataclass(frozen=True, slots=True)
class ProviderTokens:
    provider: str
    id_token: str
    id_token_expires_at: int
    refresh_token: str


@dataclass(frozen=True, slots=True)
class SignedIn:
    identity: SignInIdentity
    tokens: ProviderTokens | None
    version: str | None


@dataclass(frozen=True, slots=True)
class Provider:
    name: str
    client_id: str
    client_secret: str | None
    authority: str
    keeps_tokens: bool

    @property
    def scope(self) -> str:
        return f"{BASE_SCOPE} offline_access" if self.keeps_tokens else BASE_SCOPE

    @property
    def redirect_uri(self) -> str:
        return settings.SELFURL.rstrip("/") + CALLBACK_ROUTE.format(provider=self.name)

    def secret_form(self) -> dict[str, str]:
        return {"client_secret": self.client_secret} if self.client_secret else {}


def _refused(provider: str) -> HTTPException:
    return HTTPException(status_code=400, detail=f"Invalid {provider.title()} token")


def _not_configured(provider: str) -> HTTPException:
    return HTTPException(
        status_code=400, detail=f"{provider.title()} sign-in is not configured"
    )


def _expired() -> HTTPException:
    return HTTPException(
        status_code=400, detail="The sign-in has expired; please sign in again"
    )


def provider(name: str) -> Provider:
    if name == "microsoft":
        client_id = settings.AZURE_CLIENT_ID
        tenant = (settings.AZURE_TENANT_ID or "").lower()
        if client_id and tenant:
            return Provider(
                name,
                client_id,
                settings.AZURE_CLIENT_SECRET,
                f"{MICROSOFT_AUTHORITY}/{tenant}/v2.0",
                settings.AUTHENTICATION_SEND_MICROSOFT_IDTOKEN,
            )
    if name == "okta":
        client_id = settings.OKTA_CLIENT_ID
        issuer = (settings.OKTA_DOMAIN or "").rstrip("/")
        if client_id and issuer.startswith("https://"):
            return Provider(
                name,
                client_id,
                settings.OKTA_CLIENT_SECRET,
                issuer,
                settings.AUTHENTICATION_SEND_OKTA_IDTOKEN,
            )
    raise _not_configured(name)


def _state_key(state: str) -> str:
    return auth_helpers.app_redis_key(f"sign_in_state:{crypto.hash_token(state)}")


def clear_sign_in_cookie(response: Response) -> None:
    auth_helpers.clear_session_cookie(response, SIGN_IN_COOKIE, samesite="lax")


async def _fetch_json(
    url: str, *, form: dict[str, str] | None = None, headers: dict[str, str] | None = None
) -> dict[str, Any] | None:
    try:
        if form is None:
            response = await _client.get(url, headers=headers)
        else:
            response = await _client.post(url, data=form, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(502, detail="The sign-in provider could not be reached") from exc
    if response.is_error:
        return None
    try:
        document = response.json()
    except ValueError:
        return None
    return document if isinstance(document, dict) else None


async def _token_request(url: str, form: dict[str, str]) -> tuple[int, dict[str, Any]]:
    try:
        response = await _client.post(
            url, data=form, headers={"Accept": "application/json"}
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, detail="The sign-in provider could not be reached") from exc
    try:
        document = response.json()
    except ValueError:
        return response.status_code, {}
    return response.status_code, document if isinstance(document, dict) else {}


async def _document(url: str, *, refresh: bool = False) -> dict[str, Any]:
    fetched_at, document = _documents.get(url, (0.0, {}))
    age = monotonic() - fetched_at
    if document and age < DOCUMENT_CACHE_SECONDS and not (
        refresh and age >= DOCUMENT_REFRESH_SECONDS
    ):
        return document
    if (fetched := await _fetch_json(url)) is None:
        raise HTTPException(502, detail="The sign-in provider's keys could not be read")
    _documents[url] = (monotonic(), fetched)
    return fetched


async def _configuration(chosen: Provider) -> dict[str, Any]:
    return await _document(f"{chosen.authority}/.well-known/openid-configuration")


def _endpoint(configuration: dict[str, Any], key: str, name: str) -> str:
    endpoint = configuration.get(key)
    if not (isinstance(endpoint, str) and endpoint.startswith("https://")):
        raise HTTPException(502, detail=f"{name.title()} sign-in is misconfigured")
    return endpoint


async def _signing_key(jwks_uri: str, kid: str | None) -> Any:
    for refresh in (False, True):
        for jwk in (await _document(jwks_uri, refresh=refresh)).get("keys", []):
            if isinstance(jwk, dict) and jwk.get("kid") == kid:
                return jwt.PyJWK(jwk).key
    return None


async def verify_id_token(
    provider: str,
    id_token: str | None,
    *,
    authority: str,
    audience: str,
    nonce_hash: str | None = None,
    refreshed: bool = False,
) -> dict[str, Any]:
    if not id_token:
        raise _refused(provider)
    if not (nonce_hash or refreshed):
        raise _expired()
    try:
        header = jwt.get_unverified_header(id_token)
    except PyJWTError as exc:
        raise _refused(provider) from exc
    if header.get("alg") not in ID_TOKEN_ALGORITHMS:
        raise _refused(provider)

    configuration = await _document(f"{authority}/.well-known/openid-configuration")
    issuer, jwks_uri = configuration.get("issuer"), configuration.get("jwks_uri")
    if not (isinstance(issuer, str) and isinstance(jwks_uri, str)):
        raise HTTPException(502, detail=f"{provider.title()} sign-in is misconfigured")
    if (key := await _signing_key(jwks_uri, header.get("kid"))) is None:
        raise _refused(provider)
    required = ["exp", "iat", "iss", "aud", "sub"] + ([] if refreshed else ["nonce"])
    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=ID_TOKEN_ALGORITHMS,
            audience=audience,
            leeway=LEEWAY_SECONDS,
            options={"require": required, "verify_iss": False},
        )
    except PyJWTError as exc:
        raise _refused(provider) from exc

    expected_issuer = issuer.replace(MICROSOFT_TENANT_TEMPLATE, str(claims.get("tid")))
    if claims["iss"] != expected_issuer:
        raise _refused(provider)
    if not refreshed:
        nonce = claims["nonce"]
        if not isinstance(nonce, str) or not hmac.compare_digest(
            crypto.hash_token(nonce), nonce_hash or ""
        ):
            raise _refused(provider)
    return claims


def _names(claims: dict[str, Any]) -> tuple[str | None, str | None]:
    given, family = claims.get("given_name"), claims.get("family_name")
    if not (given or family) and isinstance(name := claims.get("name"), str):
        given, _, family = name.strip().partition(" ")
    return given or None, family or None


def _admitted_tenant(tenant: str, claims: dict[str, Any]) -> bool:
    tid = claims.get("tid")
    if not isinstance(tid, str) or claims["iss"] != f"{MICROSOFT_AUTHORITY}/{tid}/v2.0":
        return False
    return not (tenant == "organizations" and tid.lower() == MICROSOFT_CONSUMER_TENANT)


async def google_identity(access_token: str | None) -> SignInIdentity:
    client_id = settings.GOOGLE_OAUTH_CLIENT_ID
    if not client_id:
        raise _not_configured("google")
    if not access_token:
        raise _refused("google")

    info = await _fetch_json(GOOGLE_TOKENINFO_URL, form={"access_token": access_token})
    if info is None or client_id not in {info.get("aud"), info.get("azp")}:
        raise _refused("google")
    if not info.get("email") or str(info.get("email_verified")).lower() != "true":
        raise HTTPException(status_code=400, detail="Email not verified by Google")

    profile = await _fetch_json(
        GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
    )
    if profile is None or profile.get("sub") != info.get("sub"):
        raise _refused("google")
    given, family = _names(profile)
    return SignInIdentity(
        email=info["email"], email_verified=True, given_name=given, family_name=family
    )


async def microsoft_identity(
    id_token: str | None, nonce_hash: str | None
) -> SignInIdentity:
    chosen = provider("microsoft")
    claims = await verify_id_token(
        "microsoft",
        id_token,
        authority=chosen.authority,
        audience=chosen.client_id,
        nonce_hash=nonce_hash,
    )
    tenant = (settings.AZURE_TENANT_ID or "").lower()
    if not (oid := claims.get("oid")) or not _admitted_tenant(tenant, claims):
        raise _refused("microsoft")
    email = claims.get("email") or claims.get("preferred_username")
    if not email:
        raise HTTPException(status_code=400, detail="Email not found in token")
    verified = bool(claims.get("email")) and str(claims.get("xms_edov")).lower() in {
        "true",
        "1",
    }
    given, family = _names(claims)
    return SignInIdentity(
        email=email,
        email_verified=verified,
        given_name=given,
        family_name=family,
        microsoft_id=oid,
        expires_at=claims["exp"],
    )


async def okta_identity(id_token: str | None, nonce_hash: str | None) -> SignInIdentity:
    chosen = provider("okta")
    claims = await verify_id_token(
        "okta",
        id_token,
        authority=chosen.authority,
        audience=chosen.client_id,
        nonce_hash=nonce_hash,
    )
    if not claims.get("email") or claims.get("email_verified") is not True:
        raise HTTPException(status_code=400, detail="Email not verified by Okta")
    given, family = _names(claims)
    return SignInIdentity(
        email=claims["email"],
        email_verified=True,
        given_name=given,
        family_name=family,
        expires_at=claims["exp"],
    )


async def start(response: Response, name: str, version: str | None) -> str:
    chosen = provider(name)
    authorization = _endpoint(
        await _configuration(chosen), "authorization_endpoint", name
    )
    state, nonce, binding = (secrets.token_urlsafe(32) for _ in range(3))
    verifier = secrets.token_urlsafe(64)
    record = {
        "provider": name,
        "nonce_hash": crypto.hash_token(nonce),
        "verifier": crypto.encrypt_text(verifier, VERIFIER_CONTEXT),
        "binding": crypto.hash_token(binding),
        "version": version,
    }
    async with auth_helpers.app_redis() as redis:
        await redis.set(
            _state_key(state),
            json.dumps(record),
            ex=int(SIGN_IN_LIFETIME.total_seconds()),
        )
    auth_helpers.set_session_cookie(
        response, SIGN_IN_COOKIE, binding, SIGN_IN_LIFETIME, samesite="lax"
    )
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    query = urlencode(
        {
            "client_id": chosen.client_id,
            "response_type": "code",
            "redirect_uri": chosen.redirect_uri,
            "response_mode": "query",
            "scope": chosen.scope,
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{authorization}?{query}"


async def _take_state(state: str) -> dict[str, Any] | None:
    async with auth_helpers.app_redis() as redis:
        raw = await redis.getdel(_state_key(state))
    return None if raw is None else json.loads(raw)


async def finish(
    request: Request, name: str, *, code: str | None, state: str | None
) -> SignedIn:
    chosen = provider(name)
    record = await _take_state(state) if state else None
    binding = request.cookies.get(SIGN_IN_COOKIE)
    if (
        record is None
        or record["provider"] != name
        or not binding
        or not hmac.compare_digest(crypto.hash_token(binding), record["binding"])
    ):
        raise _expired()
    if not code:
        raise _refused(name)

    try:
        verifier = crypto.decrypt_text(record["verifier"], VERIFIER_CONTEXT)
    except ValueError as exc:
        raise _expired() from exc
    token_endpoint = _endpoint(await _configuration(chosen), "token_endpoint", name)
    status, answer = await _token_request(
        token_endpoint,
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": chosen.redirect_uri,
            "client_id": chosen.client_id,
            "code_verifier": verifier,
            **chosen.secret_form(),
        },
    )
    id_token = answer.get("id_token")
    if status != HTTPStatus.OK or not isinstance(id_token, str):
        raise _refused(name)

    identify = microsoft_identity if name == "microsoft" else okta_identity
    identity = await identify(id_token, record["nonce_hash"])
    tokens = None
    if chosen.keeps_tokens:
        refresh_token = answer.get("refresh_token")
        if not (isinstance(refresh_token, str) and refresh_token):
            raise HTTPException(
                502,
                detail=(
                    f"{name.title()} did not issue a refresh token, which the ID token "
                    "sent to the data connections needs"
                ),
            )
        tokens = ProviderTokens(name, id_token, identity.expires_at or 0, refresh_token)
    return SignedIn(identity=identity, tokens=tokens, version=record["version"])


async def refresh(name: str, refresh_token: str) -> ProviderTokens:
    chosen = provider(name)
    token_endpoint = _endpoint(await _configuration(chosen), "token_endpoint", name)
    status, answer = await _token_request(
        token_endpoint,
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": chosen.client_id,
            "scope": chosen.scope,
            **chosen.secret_form(),
        },
    )
    if status == HTTPStatus.BAD_REQUEST and answer.get("error") in REVOKED_ERRORS:
        raise TokenRevoked
    id_token = answer.get("id_token")
    if status != HTTPStatus.OK or not isinstance(id_token, str):
        raise HTTPException(502, detail="The sign-in provider could not renew the session")
    claims = await verify_id_token(
        name,
        id_token,
        authority=chosen.authority,
        audience=chosen.client_id,
        refreshed=True,
    )
    rotated = answer.get("refresh_token")
    return ProviderTokens(
        name,
        id_token,
        claims["exp"],
        rotated if isinstance(rotated, str) and rotated else refresh_token,
    )


async def revoke(name: str, refresh_token: str) -> None:
    chosen = provider(name)
    endpoint = (await _configuration(chosen)).get("revocation_endpoint")
    if not (isinstance(endpoint, str) and endpoint.startswith("https://")):
        return
    await _token_request(
        endpoint,
        {
            "token": refresh_token,
            "token_type_hint": "refresh_token",
            "client_id": chosen.client_id,
            **chosen.secret_form(),
        },
    )
