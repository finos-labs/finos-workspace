"""The secrets-at-rest migration (revision ff59d563599c) on data stored the old way. It
writes the v1 format, which revision 4c1d2e8f9a3b re-encrypts (test_ciphertext_binding).

As in test_migration_dialects, alembic runs in a subprocess against a SQLite file: the
database is brought to the revision before, filled with rows as the old code wrote them,
upgraded, checked, downgraded and checked again.
"""

import base64
import gzip
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from contextlib import closing
from uuid import uuid4

import pytest
import sqlalchemy as sa
import sqlalchemy_utils
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from api.crypto import AtRestCipher, DecryptionError, decode_key_material
from api.schemas import normalize_mcp_url

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEFORE = "bd12bc3c71ac"
REVISION = "ff59d563599c"
# A key of its own, so the test shows the migration uses the configured one
AES_KEY = base64.urlsafe_b64encode(b"migration-test-key-of-32-bytes!!").decode().rstrip("=")
OTHER_KEY = base64.urlsafe_b64encode(b"some-other-deployment-key-32byte").decode().rstrip("=")

UUID = sqlalchemy_utils.types.uuid.UUIDType()


def _alembic(db_path: str, *args: str) -> str:
    env = {
        **os.environ,
        "MODE": "test",
        "DATABASE_TYPE": "sqlite",
        "DB_PATH": db_path,
        "REDIS_HOST": "127.0.0.1",
        "JWT_SECRET": "migration-test-jwt-secret-of-32-bytes",
        "WORKSPACE_AES_KEY": AES_KEY,
        "STORAGE_PROVIDER": "aws",
        "APPURL": "http://localhost:3000",
        "SELFURL": "http://localhost:8000",
        "FRONTENDURL": "http://localhost:3000",
    }
    result = subprocess.run(  # noqa: S603 (the test's own alembic arguments)
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, f"alembic {args} failed:\n{result.stderr}"
    return result.stderr


def _old_encrypt(value, key: str = AES_KEY) -> str:
    """What the old AESCipher wrote: AES-256-CBC under SHA-256 of the key, base64(ct || IV)."""
    text = json.dumps(value)
    pad = 16 - len(text) % 16
    padded = (text + chr(pad) * pad).encode()
    iv = os.urandom(16)
    encryptor = Cipher(
        algorithms.AES(hashlib.sha256(key.encode()).digest()), modes.CBC(iv)
    ).encryptor()
    return base64.b64encode(encryptor.update(padded) + encryptor.finalize() + iv).decode()


def _v1_cipher(key: str = AES_KEY) -> AESGCM:
    """The v1 format: AES-256-GCM without associated data under HKDF-SHA256 of the key."""
    hkdf = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"workspace-at-rest:v1")
    return AESGCM(hkdf.derive(decode_key_material(key)))


def v1_encrypt(plaintext: bytes, key: str = AES_KEY) -> str:
    nonce = os.urandom(12)
    sealed = nonce + _v1_cipher(key).encrypt(nonce, plaintext, None)
    return "v1." + base64.urlsafe_b64encode(sealed).decode().rstrip("=")


def v1_decrypt(token: str) -> bytes:
    """The plaintext of a v1 ciphertext: "v1." + base64url(nonce || ciphertext || tag)."""
    assert token.startswith("v1.")
    raw = base64.urlsafe_b64decode(token[3:] + "=" * (-len(token[3:]) % 4))
    return _v1_cipher().decrypt(raw[:12], raw[12:], None)


def _old_decrypt(value: str):
    raw = base64.b64decode(value)
    decryptor = Cipher(
        algorithms.AES(hashlib.sha256(AES_KEY.encode()).digest()), modes.CBC(raw[-16:])
    ).decryptor()
    padded = decryptor.update(raw[:-16]) + decryptor.finalize()
    return json.loads(padded[: -padded[-1]])


@pytest.fixture
def database(tmp_path):
    db_path = str(tmp_path / "secrets.db")
    _alembic(db_path, "upgrade", BEFORE)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    yield db_path, engine
    engine.dispose()


def _seed(engine: sa.Engine) -> dict:
    ids = {name: uuid4() for name in ("user", "plain", "invite", "sdk", "web", "mcp")}
    ids.update(source=uuid4(), broken=uuid4(), copilot=uuid4())
    meta = sa.MetaData()
    user = sa.Table(
        "user",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("email", sa.String),
        sa.Column("clean_email", sa.String),
        sa.Column("password", sa.String),
        sa.Column("totp_active", sa.Boolean),
        sa.Column("two_factor_auth", sa.Boolean),
        sa.Column("referral_code", sa.String),
        sa.Column("is_superuser", sa.Boolean),
        sa.Column("totp_secret", sa.String),
        sa.Column("auth_token", sa.Text),
        sa.Column("display_settings", sa.JSON),
    )
    common = {"password": "x", "two_factor_auth": False, "is_superuser": False}
    session = sa.Table(
        "session",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("user_uuid", UUID),
        sa.Column("api_token", sa.String),
        sa.Column("app_session", sa.Boolean),
    )
    invite = sa.Table(
        "user_invite",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("email", sa.String),
        sa.Column("used", sa.Boolean),
        sa.Column("data", sa.JSON),
    )
    mcp = sa.Table(
        "mcp_servers",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("user_uuid", UUID),
        sa.Column("servers", sa.LargeBinary),
    )
    api_source = sa.Table(
        "api_source",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("user_uuid", UUID),
        sa.Column("name", sa.String),
        sa.Column("url", sa.Text),
        sa.Column("endpointHeaders", sa.Text),
    )
    copilot = sa.Table(
        "custom_copilot",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("user_uuid", UUID),
        sa.Column("url", sa.String),
        sa.Column("headers", sa.Text),
        sa.Column("copilots", sa.Text),
    )
    servers = [
        {
            "id_": "a",
            "name": "Remote",
            "url": "https://MCP.example.org/mcp/",
            "enabled": True,
            "custom_headers": {"Authorization": "Bearer remote-secret", "X-Team": "t1"},
        },
        {"id_": "b", "name": "Plain", "url": "https://plain.example.org/mcp", "enabled": True},
    ]
    with engine.begin() as conn:
        conn.execute(
            user.insert(),
            [
                {
                    **common,
                    "uuid": ids["user"],
                    "email": "secrets@mail.test",
                    "clean_email": "secrets@mail.test",
                    "referral_code": "r1",
                    "totp_active": True,
                    "totp_secret": "JBSWY3DPEHPK3PXP",
                    "auth_token": "old.sdk.jwt",
                    # As the app writes it: a JSON document holding the settings' JSON text
                    "display_settings": json.dumps(
                        {
                            "theme": "dark",
                            "openaiApiKey": "sk-openai-secret",
                            "perplexityApiKey": "pplx-secret",
                        }
                    ),
                },
                {
                    **common,
                    "uuid": ids["plain"],
                    "email": "plain@mail.test",
                    "clean_email": "plain@mail.test",
                    "referral_code": "r2",
                    "totp_active": False,
                    "totp_secret": None,
                    "auth_token": None,
                    "display_settings": {"theme": "light", "openaiApiKey": ""},
                },
            ],
        )
        conn.execute(
            session.insert(),
            [
                {"uuid": ids["sdk"], "user_uuid": ids["user"], "api_token": "old.sdk.jwt", "app_session": False},
                {"uuid": ids["web"], "user_uuid": ids["user"], "api_token": None, "app_session": True},
            ],
        )
        conn.execute(
            invite.insert(),
            {
                "uuid": ids["invite"],
                "email": "invited@mail.test",
                "used": False,
                "data": {"first_name": "In", "last_name": "Vited", "password": "Gener4ted!pass"},
            },
        )
        conn.execute(
            mcp.insert(),
            {
                "uuid": ids["mcp"],
                "user_uuid": ids["user"],
                "servers": gzip.compress(json.dumps(servers).encode()),
            },
        )
        conn.execute(
            api_source.insert(),
            [
                {
                    "uuid": ids["source"],
                    "user_uuid": ids["user"],
                    "name": "Backend",
                    "url": "https://data.example.org",
                    "endpointHeaders": _old_encrypt([{"key": "X-Api-Key", "value": "backend-secret"}]),
                },
                {
                    "uuid": ids["broken"],
                    "user_uuid": ids["user"],
                    "name": "Other key",
                    "url": "https://other.example.org",
                    "endpointHeaders": _old_encrypt([{"key": "k", "value": "v"}], OTHER_KEY),
                },
            ],
        )
        conn.execute(
            copilot.insert(),
            {
                "uuid": ids["copilot"],
                "user_uuid": ids["user"],
                "url": "https://agent.example.org",
                "headers": _old_encrypt({"Authorization": "Bearer agent-secret"}),
                "copilots": _old_encrypt([{"name": "Agent"}]),
            },
        )
    return ids


def _by_uuid(db_path: str, table: str, uuid) -> dict | None:
    """The row as SQLite holds it (a UUID is its 16 bytes)."""
    with closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(f'SELECT * FROM "{table}" WHERE uuid = ?', (uuid.bytes,)).fetchone()
    return dict(row) if row else None


def _columns(db_path: str, table: str) -> set[str]:
    with closing(sqlite3.connect(db_path)) as conn:
        return {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}


def test_upgrade_encrypts_moves_and_drops_secrets(database):
    db_path, engine = database
    ids = _seed(engine)

    log = _alembic(db_path, "upgrade", REVISION)
    engine.dispose()

    # The encrypted columns are re-encrypted; a value of another key is cleared and counted
    assert "api_source.endpointHeaders: 1 values re-encrypted, 1 that did not decrypt cleared" in log
    source = _by_uuid(db_path, "api_source", ids["source"])
    assert source["endpointHeaders"].startswith("v1.")
    assert "backend-secret" not in source["endpointHeaders"]
    assert json.loads(v1_decrypt(source["endpointHeaders"])) == [
        {"key": "X-Api-Key", "value": "backend-secret"}
    ]
    assert _by_uuid(db_path, "api_source", ids["broken"])["endpointHeaders"] is None
    copilot = _by_uuid(db_path, "custom_copilot", ids["copilot"])
    assert json.loads(v1_decrypt(copilot["headers"])) == {"Authorization": "Bearer agent-secret"}
    assert json.loads(v1_decrypt(copilot["copilots"])) == [{"name": "Agent"}]

    # TOTP secret encrypted; provider keys out of display settings, encrypted
    user = _by_uuid(db_path, "user", ids["user"])
    assert "auth_token" not in user
    assert user["totp_last_step"] is None
    assert v1_decrypt(user["totp_secret"]).decode() == "JBSWY3DPEHPK3PXP"
    assert v1_decrypt(user["openai_api_key"]).decode() == "sk-openai-secret"
    assert v1_decrypt(user["perplexity_api_key"]).decode() == "pplx-secret"
    assert json.loads(json.loads(user["display_settings"])) == {"theme": "dark"}
    # An empty key is dropped and stores nothing
    plain = _by_uuid(db_path, "user", ids["plain"])
    assert plain["totp_secret"] is None and plain["openai_api_key"] is None
    assert json.loads(plain["display_settings"]) == {"theme": "light"}

    # The SDK's session goes with its token; other sessions stay
    assert _by_uuid(db_path, "session", ids["sdk"]) is None
    web = _by_uuid(db_path, "session", ids["web"])
    assert web is not None and "api_token" not in web

    # MCP headers leave the server list for the encrypted column, keyed by normalized URL
    mcp = _by_uuid(db_path, "mcp_servers", ids["mcp"])
    servers = json.loads(gzip.decompress(mcp["servers"]))
    assert all("custom_headers" not in server for server in servers)
    assert b"remote-secret" not in gzip.decompress(mcp["servers"])
    assert json.loads(v1_decrypt(mcp["headers"])) == {
        normalize_mcp_url("https://MCP.example.org/mcp/"): {
            "Authorization": "Bearer remote-secret",
            "X-Team": "t1",
        }
    }

    # Invitations hold no password
    invite = _by_uuid(db_path, "user_invite", ids["invite"])
    assert json.loads(invite["data"]) == {"first_name": "In", "last_name": "Vited"}


def test_downgrade_restores_the_old_format_without_plaintext(database):
    db_path, engine = database
    ids = _seed(engine)
    _alembic(db_path, "upgrade", REVISION)
    _alembic(db_path, "downgrade", BEFORE)
    engine.dispose()

    # The old code reads the encrypted columns again
    source = _by_uuid(db_path, "api_source", ids["source"])
    assert _old_decrypt(source["endpointHeaders"]) == [{"key": "X-Api-Key", "value": "backend-secret"}]
    copilot = _by_uuid(db_path, "custom_copilot", ids["copilot"])
    assert _old_decrypt(copilot["headers"]) == {"Authorization": "Bearer agent-secret"}

    # No secret comes back in plain text: the authenticator is set up again
    user = _by_uuid(db_path, "user", ids["user"])
    assert user["totp_secret"] is None and user["totp_active"] == 0
    assert user["auth_token"] is None
    assert "openai_api_key" not in user
    assert "sk-openai-secret" not in json.dumps(user, default=str)
    assert "headers" not in _by_uuid(db_path, "mcp_servers", ids["mcp"])


def test_old_ciphertext_helpers_refuse_tampering():
    """The migration's reader of the old format refuses what is not a ciphertext of the key."""
    import importlib.util

    path = os.path.join(BACKEND_DIR, "alembic", "versions", "1792102721-secrets_at_rest.py")
    spec = importlib.util.spec_from_file_location("secrets_at_rest", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    from utilities.config import settings

    value = {"a": "b"}
    assert module._cbc_decrypt(module._cbc_encrypt(value)) == value
    with pytest.raises(ValueError):
        module._cbc_decrypt("not base64!")
    with pytest.raises(ValueError):
        module._cbc_decrypt(_old_encrypt(value, OTHER_KEY if settings.WORKSPACE_AES_KEY != OTHER_KEY else AES_KEY))
    assert module._v1_decrypt_json(module._v1_encrypt_json(value)) == value
    with pytest.raises(ValueError):
        module._v1_decrypt_json(v1_encrypt(b"{}", OTHER_KEY if settings.WORKSPACE_AES_KEY != OTHER_KEY else AES_KEY))
    with pytest.raises(DecryptionError):
        AtRestCipher(AES_KEY).decrypt(AtRestCipher(OTHER_KEY).encrypt(b"x", "t.c"), "t.c")
