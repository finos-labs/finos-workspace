import gzip
import hashlib
import json
from uuid import uuid4

import pytest
import sqlalchemy as sa
import sqlalchemy_utils

from api.crypto import AtRestCipher, DecryptionError
from tests.test_secrets_migration import (
    AES_KEY,
    OTHER_KEY,
    _alembic,
    _by_uuid,
    _columns,
    v1_decrypt,
    v1_encrypt,
)

BEFORE = "210b7a161dbc"
REVISION = "4c1d2e8f9a3b"
UUID = sqlalchemy_utils.types.uuid.UUIDType()

PATH_SECRET_URL = "https://mcp.example.org/api/mcp/s/path-secret-value/mcp"
QUERY_SECRET_URL = "https://tools.example.org/mcp?api_key=query-secret-value"
GRANT_URL = "https://mcp.example.org/api/mcp/s/path-secret-value/mcp"
SERVERS = [
    {"id_": "a", "name": "Zapier", "url": PATH_SECRET_URL, "enabled": True, "tools": []},
    {"id_": "b", "name": "Smithery", "url": QUERY_SECRET_URL, "enabled": True, "tools": []},
]
GRANT = {
    "token": {"access_token": "access-secret", "token_type": "Bearer"},
    "expires_at": None,
    "client": {"client_id": "client-1", "redirect_uris": ["http://test/oauth/callback"]},
    "token_endpoint": "https://auth.example.org/token",
    "resource": GRANT_URL,
}


def _v1_json(value) -> str:
    return v1_encrypt(json.dumps(value, separators=(",", ":")).encode())


@pytest.fixture
def database(tmp_path):
    db_path = str(tmp_path / "binding.db")
    _alembic(db_path, "upgrade", BEFORE)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    yield db_path, engine
    engine.dispose()


def _seed(engine: sa.Engine) -> dict:
    ids = {name: uuid4() for name in ("user", "source", "broken", "copilot", "mcp", "grant", "bad_grant")}
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
        sa.Column("totp_secret", sa.Text),
        sa.Column("openai_api_key", sa.Text),
        sa.Column("perplexity_api_key", sa.Text),
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
    mcp = sa.Table(
        "mcp_servers",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("user_uuid", UUID),
        sa.Column("servers", sa.LargeBinary),
        sa.Column("headers", sa.Text),
    )
    grant = sa.Table(
        "mcp_oauth_grant",
        meta,
        sa.Column("uuid", UUID),
        sa.Column("user_uuid", UUID),
        sa.Column("server_url", sa.String),
        sa.Column("credentials", sa.Text),
    )
    with engine.begin() as conn:
        conn.execute(
            user.insert(),
            {
                "uuid": ids["user"],
                "email": "binding@mail.test",
                "clean_email": "binding@mail.test",
                "password": "x",
                "totp_active": True,
                "two_factor_auth": False,
                "referral_code": "b1",
                "is_superuser": False,
                "totp_secret": v1_encrypt(b"JBSWY3DPEHPK3PXP"),
                "openai_api_key": v1_encrypt(b"sk-openai-secret"),
                "perplexity_api_key": v1_encrypt(b"pplx-secret"),
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
                    "endpointHeaders": _v1_json([{"key": "X-Api-Key", "value": "backend-secret"}]),
                },
                {
                    "uuid": ids["broken"],
                    "user_uuid": ids["user"],
                    "name": "Other key",
                    "url": "https://other.example.org",
                    "endpointHeaders": v1_encrypt(b"[]", OTHER_KEY),
                },
            ],
        )
        conn.execute(
            copilot.insert(),
            {
                "uuid": ids["copilot"],
                "user_uuid": ids["user"],
                "url": "https://agent.example.org",
                "headers": _v1_json({"Authorization": "Bearer agent-secret"}),
                "copilots": _v1_json([{"name": "Agent"}]),
            },
        )
        conn.execute(
            mcp.insert(),
            {
                "uuid": ids["mcp"],
                "user_uuid": ids["user"],
                "servers": gzip.compress(json.dumps(SERVERS).encode()),
                "headers": _v1_json({"https://tools.example.org/mcp": {"X-Team": "team-secret"}}),
            },
        )
        conn.execute(
            grant.insert(),
            [
                {
                    "uuid": ids["grant"],
                    "user_uuid": ids["user"],
                    "server_url": GRANT_URL,
                    "credentials": _v1_json(GRANT),
                },
                {
                    "uuid": ids["bad_grant"],
                    "user_uuid": ids["user"],
                    "server_url": "https://elsewhere.example.org/mcp",
                    "credentials": v1_encrypt(b"{}", OTHER_KEY),
                },
            ],
        )
    return ids


def _opens_only_in(token: str, context: str) -> bytes:
    cipher = AtRestCipher(AES_KEY)
    assert token.startswith("v2.")
    with pytest.raises(DecryptionError):
        cipher.decrypt(token, "custom_copilot.copilots" if context != "custom_copilot.copilots" else "user.totp_secret")
    return cipher.decrypt(token, context)


def test_upgrade_binds_every_ciphertext_and_hides_server_urls(database):
    db_path, engine = database
    ids = _seed(engine)

    log = _alembic(db_path, "upgrade", REVISION)
    engine.dispose()

    assert "api_source.endpointHeaders: 1 values re-encrypted, 1 that did not decrypt cleared" in log
    source = _by_uuid(db_path, "api_source", ids["source"])
    assert json.loads(_opens_only_in(source["endpointHeaders"], "api_source.endpointHeaders")) == [
        {"key": "X-Api-Key", "value": "backend-secret"}
    ]
    assert _by_uuid(db_path, "api_source", ids["broken"])["endpointHeaders"] is None
    copilot = _by_uuid(db_path, "custom_copilot", ids["copilot"])
    assert json.loads(_opens_only_in(copilot["headers"], "custom_copilot.headers")) == {
        "Authorization": "Bearer agent-secret"
    }
    assert json.loads(_opens_only_in(copilot["copilots"], "custom_copilot.copilots")) == [{"name": "Agent"}]
    user = _by_uuid(db_path, "user", ids["user"])
    assert _opens_only_in(user["totp_secret"], "user.totp_secret") == b"JBSWY3DPEHPK3PXP"
    assert _opens_only_in(user["openai_api_key"], "user.openai_api_key") == b"sk-openai-secret"
    assert _opens_only_in(user["perplexity_api_key"], "user.perplexity_api_key") == b"pplx-secret"

    mcp = _by_uuid(db_path, "mcp_servers", ids["mcp"])
    assert isinstance(mcp["servers"], str)
    for secret in ("path-secret-value", "query-secret-value", "mcp.example.org"):
        assert secret not in mcp["servers"]
    assert json.loads(_opens_only_in(mcp["servers"], "mcp_servers.servers")) == SERVERS
    assert json.loads(_opens_only_in(mcp["headers"], "mcp_servers.headers")) == {
        "https://tools.example.org/mcp": {"X-Team": "team-secret"}
    }

    assert "server_url" not in _columns(db_path, "mcp_oauth_grant")
    grant = _by_uuid(db_path, "mcp_oauth_grant", ids["grant"])
    assert grant["server_hash"] == hashlib.sha256(GRANT_URL.encode()).hexdigest()
    assert "path-secret-value" not in json.dumps(grant, default=str)
    assert json.loads(_opens_only_in(grant["credentials"], "mcp_oauth_grant.credentials")) == {
        **GRANT,
        "user_uuid": str(ids["user"]),
        "server_url": GRANT_URL,
    }
    assert _by_uuid(db_path, "mcp_oauth_grant", ids["bad_grant"]) is None
    assert "1 grants keyed by server hash, 1 that did not decrypt deleted" in log


def test_downgrade_restores_the_v1_format(database):
    db_path, engine = database
    ids = _seed(engine)
    _alembic(db_path, "upgrade", REVISION)
    _alembic(db_path, "downgrade", BEFORE)
    engine.dispose()

    source = _by_uuid(db_path, "api_source", ids["source"])
    assert json.loads(v1_decrypt(source["endpointHeaders"])) == [
        {"key": "X-Api-Key", "value": "backend-secret"}
    ]
    user = _by_uuid(db_path, "user", ids["user"])
    assert v1_decrypt(user["openai_api_key"]) == b"sk-openai-secret"
    mcp = _by_uuid(db_path, "mcp_servers", ids["mcp"])
    assert json.loads(gzip.decompress(mcp["servers"])) == SERVERS
    assert json.loads(v1_decrypt(mcp["headers"])) == {
        "https://tools.example.org/mcp": {"X-Team": "team-secret"}
    }

    assert "server_hash" not in _columns(db_path, "mcp_oauth_grant")
    grant = _by_uuid(db_path, "mcp_oauth_grant", ids["grant"])
    assert grant["server_url"] == GRANT_URL
    assert json.loads(v1_decrypt(grant["credentials"])) == GRANT
