"""Encryption at rest (api/crypto.py), the checks on the keys the API starts with, and the
randomness of generated secrets."""

import base64
import re

import pytest
from pydantic import ValidationError

from api import base, crypto, schemas
from api.database import Base
from api.models.model_helpers import EncryptedStringType, EncryptedType
from utilities.config import Settings, settings

KEY = base64.urlsafe_b64encode(b"k" * 32).decode().rstrip("=")
OTHER_KEY = base64.urlsafe_b64encode(b"o" * 32).decode().rstrip("=")
CONTEXT = "api_source.endpointHeaders"


def _flip_last_byte(token: str) -> str:
    """Changes the tag's last byte. The token's last base64url character also carries padding
    bits that decoding ignores, so changing that character can leave the bytes as they were."""
    raw = base64.urlsafe_b64decode(token[3:] + "=" * (-len(token[3:]) % 4))
    tampered = raw[:-1] + bytes([raw[-1] ^ 1])
    return token[:3] + base64.urlsafe_b64encode(tampered).decode().rstrip("=")


class TestCipher:
    def test_round_trip(self):
        cipher = crypto.AtRestCipher(KEY)
        assert cipher.decrypt(cipher.encrypt(b"secret value", CONTEXT), CONTEXT) == b"secret value"
        assert cipher.decrypt(cipher.encrypt(b"", CONTEXT), CONTEXT) == b""

    def test_format_is_versioned_base64url_with_a_fresh_nonce(self):
        cipher = crypto.AtRestCipher(KEY)
        first, second = cipher.encrypt(b"same", CONTEXT), cipher.encrypt(b"same", CONTEXT)
        assert first != second
        for token in (first, second):
            assert token.startswith("v2.")
            assert re.fullmatch(r"[A-Za-z0-9_-]+", token[3:])
            raw = base64.urlsafe_b64decode(token[3:] + "=" * (-len(token[3:]) % 4))
            # 12-byte nonce, the 4 encrypted bytes and the 16-byte tag
            assert len(raw) == 12 + 4 + 16
            assert b"same" not in raw

    def test_the_data_key_is_derived_not_the_key_material(self):
        """AES-GCM under the raw key material does not open the ciphertext."""
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        token = crypto.AtRestCipher(KEY).encrypt(b"x", CONTEXT)
        raw = base64.urlsafe_b64decode(token[3:] + "=" * (-len(token[3:]) % 4))
        with pytest.raises(InvalidTag):
            AESGCM(crypto.decode_key_material(KEY)).decrypt(raw[:12], raw[12:], CONTEXT.encode())

    @pytest.mark.parametrize(
        "tamper",
        [
            _flip_last_byte,  # tag
            lambda t: t[:3] + ("A" if t[3] != "A" else "B") + t[4:],  # nonce
            lambda t: t[:20] + ("A" if t[20] != "A" else "B") + t[21:],  # ciphertext
            lambda t: t[:-8],  # truncated
            lambda t: "v1." + t[3:],  # another version
            lambda t: t[3:],  # no version
            lambda t: t + "!",  # not base64url
            lambda t: "v2.",  # empty
        ],
    )
    def test_tampered_ciphertext_is_refused(self, tamper):
        cipher = crypto.AtRestCipher(KEY)
        token = cipher.encrypt(b"a value long enough to tamper with", CONTEXT)
        with pytest.raises(crypto.DecryptionError):
            cipher.decrypt(tamper(token), CONTEXT)

    def test_another_key_cannot_decrypt(self):
        token = crypto.AtRestCipher(KEY).encrypt(b"x", CONTEXT)
        with pytest.raises(crypto.DecryptionError):
            crypto.AtRestCipher(OTHER_KEY).decrypt(token, CONTEXT)

    @pytest.mark.parametrize(
        "elsewhere", ["custom_copilot.headers", "api_source.endpointheaders", "", "x"]
    )
    def test_a_ciphertext_decrypts_only_where_it_is_kept(self, elsewhere):
        """The context is the associated data: a value copied to another column (or Redis
        key) does not decrypt there."""
        cipher = crypto.AtRestCipher(KEY)
        token = cipher.encrypt(b"secret", CONTEXT)
        with pytest.raises((crypto.DecryptionError, ValueError)):
            cipher.decrypt(token, elsewhere)

    def test_a_value_is_encrypted_for_a_context(self):
        with pytest.raises(ValueError, match="context"):
            crypto.AtRestCipher(KEY).encrypt(b"x", "")

    def test_json_and_text_helpers_use_the_configured_key(self):
        value = {"Authorization": "Bearer abc", "list": [1, 2]}
        token = crypto.encrypt_json(value, CONTEXT)
        assert crypto.decrypt_json(token, CONTEXT) == value
        assert crypto.AtRestCipher(settings.WORKSPACE_AES_KEY).decrypt(token, CONTEXT)
        assert crypto.decrypt_text(crypto.encrypt_text("sk-1", "user.openai_api_key"), "user.openai_api_key") == "sk-1"
        with pytest.raises(crypto.DecryptionError):
            crypto.decrypt_json(token, "custom_copilot.headers")

    def test_hash_token_is_sha256_hex(self):
        digest = crypto.hash_token("ws_mcp_abc")
        assert re.fullmatch(r"[0-9a-f]{64}", digest)
        assert digest == crypto.hash_token("ws_mcp_abc") != crypto.hash_token("ws_mcp_abd")


class TestColumnTypes:
    def test_encrypted_type_stores_ciphertext_only(self):
        column = EncryptedType("api_source.endpointHeaders")
        stored = column.process_bind_param({"X-Api-Key": "backend-secret"}, None)
        assert stored.startswith("v2.") and "backend-secret" not in stored
        assert column.process_result_value(stored, None) == {"X-Api-Key": "backend-secret"}
        assert column.process_bind_param(None, None) is None
        with pytest.raises(ValueError):
            column.process_bind_param("a string", None)

    def test_encrypted_string_type_stores_ciphertext_only(self):
        column = EncryptedStringType("user.totp_secret")
        stored = column.process_bind_param("JBSWY3DPEHPK3PXP", None)
        assert stored.startswith("v2.") and "JBSWY3DPEHPK3PXP" not in stored
        assert column.process_result_value(stored, None) == "JBSWY3DPEHPK3PXP"
        with pytest.raises(ValueError):
            column.process_bind_param({"not": "a string"}, None)

    def test_a_tampered_column_value_raises(self):
        stored = EncryptedStringType("user.totp_secret").process_bind_param("secret", None)
        with pytest.raises(crypto.DecryptionError):
            EncryptedStringType("user.totp_secret").process_result_value(stored[:-2] + "AA", None)

    def test_a_value_moved_to_another_column_raises(self):
        """A provider key copied into another user column, or MCP headers copied into a
        data backend's headers, do not decrypt there."""
        key = EncryptedStringType("user.openai_api_key").process_bind_param("sk-victim", None)
        with pytest.raises(crypto.DecryptionError):
            EncryptedStringType("user.perplexity_api_key").process_result_value(key, None)
        headers = EncryptedType("mcp_servers.headers").process_bind_param({"a": {"b": "c"}}, None)
        with pytest.raises(crypto.DecryptionError):
            EncryptedType("api_source.endpointHeaders").process_result_value(headers, None)

    def test_every_encrypted_column_is_bound_to_itself(self):
        """Each EncryptedType and EncryptedStringType column of the schema encrypts for its
        own "<table>.<column>"."""
        columns = [
            column
            for table in Base.metadata.tables.values()
            for column in table.columns
            if isinstance(column.type, EncryptedType | EncryptedStringType)
        ]
        assert {f"{c.table.name}.{c.name}" for c in columns} >= {
            "api_source.endpointHeaders",
            "custom_copilot.headers",
            "custom_copilot.copilots",
            "mcp_servers.servers",
            "mcp_servers.headers",
            "mcp_oauth_grant.credentials",
            "user.totp_secret",
            "user.openai_api_key",
            "user.perplexity_api_key",
        }
        for column in columns:
            assert column.type.context == f"{column.table.name}.{column.name}"


class TestKeyValidation:
    @pytest.mark.parametrize(
        "value",
        [
            "",
            "sixteenbytekey!!",  # not base64url
            "pat-aes-key",  # decodes to 8 bytes
            base64.urlsafe_b64encode(b"k" * 31).decode().rstrip("="),  # 31 bytes
            "a" * 43 + "!",
        ],
    )
    def test_weak_or_malformed_aes_key_is_refused(self, value):
        with pytest.raises(ValueError):
            crypto.decode_key_material(value)
        with pytest.raises(ValidationError, match="WORKSPACE_AES_KEY"):
            Settings(WORKSPACE_AES_KEY=value)

    def test_generated_keys_are_accepted(self):
        import secrets

        for _ in range(20):
            assert len(crypto.decode_key_material(secrets.token_urlsafe(32))) == 32

    @pytest.mark.parametrize("name", ["JWT_SECRET", "LOCAL_STORAGE_SECRET_KEY"])
    @pytest.mark.parametrize("value", ["", "pat-jose-secret", "default_secret_key", "x" * 31])
    def test_short_secrets_are_refused(self, name, value):
        with pytest.raises(ValidationError, match=name):
            Settings(**{name: value})

    def test_folder_storage_needs_a_signing_key(self):
        with pytest.raises(ValidationError, match="LOCAL_STORAGE_SECRET_KEY"):
            Settings(STORAGE_PROVIDER="folder", LOCAL_STORAGE_SECRET_KEY=None)
        assert Settings(STORAGE_PROVIDER="aws", LOCAL_STORAGE_SECRET_KEY=None)


class TestRandomSecrets:
    def test_random_password_is_strong_and_accepted(self):
        passwords = {base.random_password() for _ in range(50)}
        assert len(passwords) == 50
        for password in passwords:
            assert len(password) == 16
            assert schemas.check_password(password) == password

    def test_generators_use_the_secrets_module(self):
        import inspect

        source = inspect.getsource(base)
        assert "import random\n" not in source
        assert "random.choice" not in source
