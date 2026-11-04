import base64
import binascii
import hashlib
import json
import os
import re
from functools import cache
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

MIN_KEY_BYTES = 32
VERSION_PREFIX = "v2."
HKDF_INFO = b"workspace-at-rest:v2"
NONCE_BYTES = 12
TAG_BYTES = 16

_BASE64URL = re.compile(r"[A-Za-z0-9_-]+={0,2}")
_GENERATE_HINT = 'python -c "import secrets; print(secrets.token_urlsafe(32))"'


class DecryptionError(ValueError):
    ...


def _b64decode(value: str) -> bytes:
    if not _BASE64URL.fullmatch(value):
        raise ValueError("not base64url")
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except binascii.Error as exc:
        raise ValueError("not base64url") from exc


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def decode_key_material(value: str) -> bytes:
    try:
        material = _b64decode(value or "")
    except ValueError as exc:
        raise ValueError(
            f"WORKSPACE_AES_KEY must be a base64url string; generate one with {_GENERATE_HINT}"
        ) from exc
    if len(material) < MIN_KEY_BYTES:
        raise ValueError(
            f"WORKSPACE_AES_KEY must decode to at least {MIN_KEY_BYTES} bytes; "
            f"generate one with {_GENERATE_HINT}"
        )
    return material


def _associated_data(context: str) -> bytes:
    if not isinstance(context, str) or not context:
        raise ValueError("A ciphertext needs the context it is kept in")
    return context.encode("utf-8")


class AtRestCipher:
    def __init__(self, key_material: str):
        data_key = HKDF(
            algorithm=hashes.SHA256(), length=32, salt=None, info=HKDF_INFO
        ).derive(decode_key_material(key_material))
        self._aead = AESGCM(data_key)

    def encrypt(self, plaintext: bytes, context: str) -> str:
        associated_data = _associated_data(context)
        nonce = os.urandom(NONCE_BYTES)
        sealed = self._aead.encrypt(nonce, plaintext, associated_data)
        return VERSION_PREFIX + _b64encode(nonce + sealed)

    def decrypt(self, token: str, context: str) -> bytes:
        associated_data = _associated_data(context)
        if not isinstance(token, str) or not token.startswith(VERSION_PREFIX):
            raise DecryptionError("Not a v2 ciphertext")
        try:
            raw = _b64decode(token[len(VERSION_PREFIX) :])
        except ValueError as exc:
            raise DecryptionError("Ciphertext is not base64url") from exc
        if len(raw) < NONCE_BYTES + TAG_BYTES:
            raise DecryptionError("Ciphertext is too short")
        try:
            return self._aead.decrypt(raw[:NONCE_BYTES], raw[NONCE_BYTES:], associated_data)
        except InvalidTag as exc:
            raise DecryptionError(
                "Ciphertext failed authentication: altered, of another key or kept elsewhere"
            ) from exc


@cache
def at_rest_cipher() -> AtRestCipher:
    from utilities.config import settings  # noqa: PLC0415

    return AtRestCipher(settings.WORKSPACE_AES_KEY)


def encrypt_text(value: str, context: str) -> str:
    return at_rest_cipher().encrypt(value.encode("utf-8"), context)


def decrypt_text(token: str, context: str) -> str:
    return at_rest_cipher().decrypt(token, context).decode("utf-8")


def encrypt_json(value: Any, context: str) -> str:
    serialized = json.dumps(value, separators=(",", ":"))
    return at_rest_cipher().encrypt(serialized.encode("utf-8"), context)


def decrypt_json(token: str, context: str) -> Any:
    return json.loads(at_rest_cipher().decrypt(token, context))


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
