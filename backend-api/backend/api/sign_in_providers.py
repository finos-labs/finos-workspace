import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta
from time import monotonic
from typing import Any

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
SIGN_IN_NONCE_LIFETIME = timedelta(minutes=5)

_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
_documents: dict[str, tuple[float, dict[str, Any]]] = {}


@dataclass(frozen=True, slots=True)
class SignInIdentity:
    email: str
    email_verified: bool
    given_name: str | None = None
    family_name: str | None = None
    microsoft_id: str | None = None


def _refused(provider: str) -> HTTPException:
    return HTTPException(status_code=400, detail=f"Invalid {provider.title()} token")


def _not_configured(provider: str) -> HTTPException:
    return HTTPException(
        status_code=400, detail=f"{provider.title()} sign-in is not configured"
    )


def _nonce_key(sign_in_id: str) -> str:
    return auth_helpers.app_redis_key(f"sign_in_nonce:{crypto.hash_token(sign_in_id)}")


async def issue_sign_in_nonce(response: Response) -> str:
    nonce, sign_in_id = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    lifetime = int(SIGN_IN_NONCE_LIFETIME.total_seconds())
    async with auth_helpers.app_redis() as redis:
        await redis.set(_nonce_key(sign_in_id), crypto.hash_token(nonce), ex=lifetime)
    auth_helpers.set_session_cookie(
        response, SIGN_IN_COOKIE, sign_in_id, SIGN_IN_NONCE_LIFETIME
    )
    return nonce


async def take_sign_in_nonce(request: Request) -> str | None:
    if not (sign_in_id := request.cookies.get(SIGN_IN_COOKIE)):
        return None
    async with auth_helpers.app_redis() as redis:
        nonce_hash = await redis.getdel(_nonce_key(sign_in_id))
    return nonce_hash.decode() if isinstance(nonce_hash, bytes) else nonce_hash


def clear_sign_in_cookie(response: Response) -> None:
    auth_helpers.clear_session_cookie(response, SIGN_IN_COOKIE)


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
    nonce_hash: str | None,
) -> dict[str, Any]:
    if not id_token:
        raise _refused(provider)
    if not nonce_hash:
        raise HTTPException(
            status_code=400, detail="The sign-in has expired; please sign in again"
        )
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
    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=ID_TOKEN_ALGORITHMS,
            audience=audience,
            leeway=LEEWAY_SECONDS,
            options={
                "require": ["exp", "iat", "iss", "aud", "sub", "nonce"],
                "verify_iss": False,
            },
        )
    except PyJWTError as exc:
        raise _refused(provider) from exc

    expected_issuer = issuer.replace(MICROSOFT_TENANT_TEMPLATE, str(claims.get("tid")))
    nonce = claims["nonce"]
    if (
        claims["iss"] != expected_issuer
        or not isinstance(nonce, str)
        or not hmac.compare_digest(crypto.hash_token(nonce), nonce_hash)
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
    client_id, tenant = settings.AZURE_CLIENT_ID, (settings.AZURE_TENANT_ID or "").lower()
    if not (client_id and tenant):
        raise _not_configured("microsoft")

    claims = await verify_id_token(
        "microsoft",
        id_token,
        authority=f"{MICROSOFT_AUTHORITY}/{tenant}/v2.0",
        audience=client_id,
        nonce_hash=nonce_hash,
    )
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
    )


async def okta_identity(id_token: str | None, nonce_hash: str | None) -> SignInIdentity:
    client_id, issuer = settings.OKTA_CLIENT_ID, (settings.OKTA_DOMAIN or "").rstrip("/")
    if not (client_id and issuer.startswith("https://")):
        raise _not_configured("okta")

    claims = await verify_id_token(
        "okta", id_token, authority=issuer, audience=client_id, nonce_hash=nonce_hash
    )
    if not claims.get("email") or claims.get("email_verified") is not True:
        raise HTTPException(status_code=400, detail="Email not verified by Okta")
    given, family = _names(claims)
    return SignInIdentity(
        email=claims["email"], email_verified=True, given_name=given, family_name=family
    )
