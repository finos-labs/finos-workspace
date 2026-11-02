import time
from datetime import timedelta
from time import monotonic
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm
from sqlalchemy import select

from utilities.config import settings

from . import base, database, models, provider_tokens

IDENTITY_HEADER = "X-Workspace-Identity"
ALGORITHM = "ES256"
TOKEN_SECONDS = 300
TOKEN_CACHE_SECONDS = 120
TOKEN_CACHE_ENTRIES = 10_000
KEY_SIGNS_FOR = timedelta(days=30)
KEY_PUBLISHED_FOR = timedelta(days=31)
KEY_RELOAD_SECONDS = 300

_signer: dict[str, Any] = {}
_tokens: dict[tuple[UUID, str, str], tuple[float, str]] = {}


def audience_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc.rpartition('@')[2]}".lower()


def _new_key() -> models.SigningKey:
    private = ec.generate_private_key(ec.SECP256R1())
    kid = uuid4()
    return models.SigningKey(
        uuid=kid,
        private_key=private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode(),
        public_jwk={
            **ECAlgorithm.to_jwk(private.public_key(), as_dict=True),
            "kid": str(kid),
            "use": "sig",
            "alg": ALGORITHM,
        },
    )


async def _signing_key() -> tuple[str, Any]:
    if _signer and monotonic() - _signer["loaded"] < KEY_RELOAD_SECONDS:
        return _signer["kid"], _signer["key"]
    cutoff = base.get_now() - KEY_SIGNS_FOR
    async with database.AsyncWriteSessionLocal.session() as db:
        row = (
            await db.execute(
                select(models.SigningKey)
                .where(models.SigningKey.created_date > cutoff)
                .order_by(models.SigningKey.created_date.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if row is None:
            row = _new_key()
            db.add(row)
            await db.commit()
        kid, pem = str(row.uuid), row.private_key
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    _signer.update(loaded=monotonic(), kid=kid, key=key)
    return kid, key


async def mint(user_uuid: UUID, email: str, audience: str) -> str:
    cache_key = (user_uuid, email, audience)
    now = time.time()
    if (cached := _tokens.get(cache_key)) is not None and (
        now - cached[0] < TOKEN_CACHE_SECONDS
    ):
        return cached[1]
    kid, key = await _signing_key()
    issued = int(now)
    token = jwt.encode(
        {
            "iss": settings.SELFURL.rstrip("/"),
            "sub": str(user_uuid),
            "email": email,
            "aud": audience,
            "iat": issued,
            "exp": issued + TOKEN_SECONDS,
            "jti": str(uuid4()),
        },
        key,
        algorithm=ALGORITHM,
        headers={"kid": kid},
    )
    if cache_key not in _tokens and len(_tokens) >= TOKEN_CACHE_ENTRIES:
        _tokens.pop(next(iter(_tokens)))
    _tokens[cache_key] = (now, token)
    return token


async def jwks() -> dict[str, list[dict[str, Any]]]:
    await _signing_key()
    cutoff = base.get_now() - KEY_PUBLISHED_FOR
    async with database.AsyncWriteSessionLocal.session() as db:
        keys = (
            await db.execute(
                select(models.SigningKey.public_jwk)
                .where(models.SigningKey.created_date > cutoff)
                .order_by(models.SigningKey.created_date.desc())
            )
        ).scalars()
        return {"keys": list(keys)}


async def headers_for(
    user_uuid: UUID,
    email: str,
    session_uuid: UUID | None,
    url: str,
    *,
    provider_token: bool = True,
) -> dict[str, str]:
    headers = {IDENTITY_HEADER: await mint(user_uuid, email, audience_of(url))}
    forwarding = (
        settings.AUTHENTICATION_SEND_MICROSOFT_IDTOKEN
        or settings.AUTHENTICATION_SEND_OKTA_IDTOKEN
    )
    if provider_token and forwarding and session_uuid is not None:
        held = await provider_tokens.current(session_uuid)
        if held is not None:
            headers[held.header] = held.id_token
    return headers
