import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pyotp
import pytest
from sqlalchemy import delete, text, update

from api import helpers, models, schemas
from api.models import User
from routers import app_helpers
from routers.app import file_storage
from routers.app.index import process_create_user
from routers.routers_helpers import register_app_user
from tests.fixtures.base import _AUTH_USER, _DEFAULT_USER_MAP_UUID

USER_UUID = UUID(_AUTH_USER["user_uuid"])


def _hex(uuid) -> str:
    return str(uuid).replace("-", "")


async def _scalar(db_session, sql: str, **params):
    return (await db_session.execute(text(sql), params)).scalar_one_or_none()


class TestCopilotKeys:
    async def test_keys_are_encrypted_and_never_returned(self, auth_client, db_session):
        response = await auth_client.put(
            "/app/copilot-keys", json={"openai_api_key": "sk-openai-at-rest"}
        )
        assert response.status_code == 200
        assert response.json() == {"has_openai_key": True, "has_perplexity_key": False}

        stored = await _scalar(
            db_session,
            "SELECT openai_api_key FROM `user` WHERE uuid = UNHEX(:uuid)",
            uuid=_hex(USER_UUID),
        )
        assert stored.startswith("v2.") and "sk-openai-at-rest" not in stored

        for path in ("/app/copilot-keys", "/app/user", "/app/dash/validate-and-sync"):
            response = await auth_client.get(path)
            assert "sk-openai-at-rest" not in response.text, path
        assert (await auth_client.get("/app/copilot-keys")).json()["has_openai_key"] is True

    async def test_a_key_left_out_stays_and_null_clears(self, auth_client, db_session):
        await auth_client.put("/app/copilot-keys", json={"openai_api_key": "sk-1"})
        response = await auth_client.put(
            "/app/copilot-keys", json={"perplexity_api_key": "pplx-2"}
        )
        assert response.json() == {"has_openai_key": True, "has_perplexity_key": True}

        response = await auth_client.put("/app/copilot-keys", json={"openai_api_key": None})
        assert response.json() == {"has_openai_key": False, "has_perplexity_key": True}

        keys = await app_helpers.get_copilot_provider_keys(db_session, USER_UUID)
        assert keys == schemas.CopilotProviderKeys(perplexity_api_key="pplx-2")

    @pytest.mark.parametrize(
        "body",
        [
            {"openai_api_key": "sk with spaces"},
            {"openai_api_key": ""},
            {"openai_api_key": "x" * 1025},
            {"anthropic_api_key": "sk-other"},
        ],
    )
    async def test_malformed_keys_are_refused(self, auth_client, body):
        assert (await auth_client.put("/app/copilot-keys", json=body)).status_code == 422

    async def test_display_settings_drop_provider_keys(self, auth_client, db_session):
        response = await auth_client.post(
            "/app/display-settings",
            json={"theme": "dark", "openaiApiKey": "sk-in-settings", "perplexityApiKey": "p"},
        )
        assert response.status_code == 200

        stored = await _scalar(
            db_session,
            "SELECT display_settings FROM `user` WHERE uuid = UNHEX(:uuid)",
            uuid=_hex(USER_UUID),
        )
        assert "sk-in-settings" not in stored and "openaiApiKey" not in stored
        assert json.loads(json.loads(stored))["theme"] == "dark"
        assert "sk-in-settings" not in (await auth_client.get("/app/user")).text


MCP_URL = "https://mcp.example.org/mcp"


def _server(url: str = MCP_URL, **extra) -> dict:
    return {"id": "s1", "name": "Server", "url": url, "enabled": True, **extra}


async def _save(auth_client, *servers) -> list[dict]:
    response = await auth_client.post("/app/mcp-servers", json={"servers": list(servers)})
    assert response.status_code == 200, response.text
    return response.json()["servers"]


async def _stored_mcp(db_session) -> tuple[str | None, str | None]:
    row = (
        await db_session.execute(
            text("SELECT servers, headers FROM mcp_servers WHERE user_uuid = UNHEX(:uuid)"),
            {"uuid": _hex(USER_UUID)},
        )
    ).one()
    return row.servers, row.headers


class TestMcpServerHeaders:
    async def test_values_are_stored_encrypted_and_only_names_return(
        self, auth_client, db_session
    ):
        servers = await _save(
            auth_client,
            _server(customHeaders={"Authorization": "Bearer mcp-secret", "X-Team": "team-1"}),
        )
        assert servers[0]["customHeaderNames"] == ["Authorization", "X-Team"]
        assert servers[0]["hasToken"] is True
        assert "customHeaders" not in servers[0]

        server_list, headers = await _stored_mcp(db_session)
        assert server_list.startswith("v2.") and "mcp.example.org" not in server_list
        assert "mcp-secret" not in server_list and "team-1" not in server_list
        assert headers.startswith("v2.") and "mcp-secret" not in headers

        for path in ("/app/dash/validate-and-sync", "/app/user"):
            assert "mcp-secret" not in (await auth_client.get(path)).text

        assert await app_helpers.get_mcp_server_headers(db_session, USER_UUID, MCP_URL + "/") == {
            "Authorization": "Bearer mcp-secret",
            "X-Team": "team-1",
        }

    async def test_omitted_keeps_null_removes(self, auth_client):
        await _save(auth_client, _server(customHeaders={"Authorization": "Bearer a", "X-Team": "t"}))

        servers = await _save(auth_client, _server())
        assert servers[0]["customHeaderNames"] == ["Authorization", "X-Team"]

        servers = await _save(auth_client, _server(customHeaders={"x-team": None}))
        assert servers[0]["customHeaderNames"] == ["Authorization"]

        servers = await _save(auth_client, _server(customHeaders={"Authorization": None}))
        assert servers[0]["customHeaderNames"] == []
        assert servers[0]["hasToken"] is False

    async def test_headers_never_follow_a_server_to_another_url(self, auth_client, db_session):
        await _save(auth_client, _server(customHeaders={"Authorization": "Bearer a"}))

        servers = await _save(auth_client, _server(url="https://elsewhere.example.org/mcp"))
        assert servers[0]["customHeaderNames"] == []
        assert await app_helpers.get_mcp_server_headers(db_session, USER_UUID, MCP_URL) is None

        await _save(auth_client, _server(customHeaders={"Authorization": "Bearer a"}))
        assert await _save(auth_client) == []
        assert (await _stored_mcp(db_session))[1] is None

    @pytest.mark.parametrize(
        "headers",
        [{"Bad Name": "v"}, {"X-Ok": "line\r\nInjected: 1"}, {"X-Ok": "v" * 8193}],
    )
    async def test_malformed_headers_are_refused(self, auth_client, headers):
        response = await auth_client.post(
            "/app/mcp-servers", json={"servers": [_server(customHeaders=headers)]}
        )
        assert response.status_code == 422

    async def test_a_credential_in_a_server_url_is_encrypted_at_rest(
        self, auth_client, db_session
    ):
        path_url = "https://mcp.example.org/api/mcp/s/path-secret-value/mcp"
        query_url = "https://tools.example.org/mcp?api_key=query-secret-value"
        servers = await _save(
            auth_client, _server(url=path_url), {**_server(url=query_url), "id": "s2"}
        )
        assert [server["url"] for server in servers] == [path_url, query_url]

        server_list, _ = await _stored_mcp(db_session)
        assert server_list.startswith("v2.")
        for secret in ("path-secret-value", "query-secret-value", "example.org"):
            assert secret not in server_list
        assert await app_helpers.get_mcp_server_headers(db_session, USER_UUID, path_url) == {}

    @pytest.mark.parametrize("url", ["http://localhost:8123/mcp", "http://[::1]:8123/mcp", MCP_URL])
    async def test_no_route_hands_the_headers_of_a_server_to_the_browser(self, auth_client, url):
        await _save(auth_client, _server(url=url, customHeaders={"X-Local": "local-value"}))

        response = await auth_client.post("/app/mcp-servers/local-headers", json={"url": url})

        assert response.status_code in {404, 405}
        assert "local-value" not in response.text


class TestTotp:
    async def test_secret_is_encrypted_and_a_code_works_once(self, auth_client, db_session):
        secret = (await auth_client.post("/totp", json={})).json()["secret"]
        stored = await _scalar(
            db_session,
            "SELECT totp_secret FROM `user` WHERE uuid = UNHEX(:uuid)",
            uuid=_hex(USER_UUID),
        )
        assert stored.startswith("v2.") and secret not in stored

        code = int(pyotp.TOTP(secret).now())
        response = await auth_client.post("/totp/activate", json={"totp_token": code})
        assert response.status_code == 200
        response = await auth_client.post("/totp/activate", json={"totp_token": code})
        assert response.status_code == 401

    async def test_verification_window_and_replay(self, db_session, monkeypatch):
        await _create_auth_user(db_session)
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        moment = datetime(2026, 1, 1, tzinfo=UTC)
        while not totp.at(moment).startswith("0"):
            moment += timedelta(seconds=30)
        _freeze(monkeypatch, moment)
        await db_session.execute(
            update(User)
            .where(User.uuid == USER_UUID)
            .values(totp_secret=secret, totp_last_step=None)
        )
        await db_session.commit()

        def code(offset: int) -> int:
            return int(totp.at(moment + timedelta(seconds=30 * offset)))

        async def verify(value) -> bool:
            return await helpers.verify_totp(db_session, USER_UUID, secret, value)

        assert not await verify(code(-2))
        assert not await verify(code(2))
        assert await verify(code(-1))
        assert await verify(code(0))
        assert not await verify(code(0))
        assert not await verify(code(-1))
        assert await verify(code(1))
        assert not await verify(None)
        assert not await helpers.verify_totp(db_session, USER_UUID, None, code(1))


async def _create_auth_user(db_session):
    from tests.fixtures.base import _cleanup_user_fixture_records, _create_user_fixture

    await _cleanup_user_fixture_records(db_session, _AUTH_USER)
    await _create_user_fixture(db_session, _AUTH_USER)


def _freeze(monkeypatch, moment: datetime):
    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return moment if tz else moment.replace(tzinfo=None)

    monkeypatch.setattr(helpers, "datetime", Frozen)


async def test_login_payload_carries_flags_not_secrets(app_client, db_session):
    email = f"keys_{uuid4().hex[:8]}@example.com"
    password = "KeysTestPassword123!"
    user = User(
        uuid=uuid4(),
        email=email,
        clean_email=email,
        password=password,
        confirmed=True,
        openai_api_key="sk-login-secret",
        permissions_uuid=_DEFAULT_USER_MAP_UUID,
    )
    db_session.add(user)
    await db_session.commit()
    try:
        await app_helpers.save_mcp_servers(
            db_session,
            user.uuid,
            [schemas.MCPServer.model_validate(_server(customHeaders={"X-Key": "mcp-login-secret"}))],
        )
        response = await app_client.post(
            "/app/login",
            json={
                "email": email,
                "password": password,
                "remember": False,
                "source": "app",
                "totp_token": None,
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["copilot_keys"] == {"has_openai_key": True, "has_perplexity_key": False}
        assert "sk-login-secret" not in response.text
        assert "mcp-login-secret" not in response.text
        for server in body["mcp_servers"] or []:
            assert "customHeaders" not in server
    finally:
        await db_session.execute(delete(models.MCPServers).where(models.MCPServers.user_uuid == user.uuid))
        await db_session.execute(delete(models.Session).where(models.Session.user_uuid == user.uuid))
        await db_session.execute(delete(User).where(User.uuid == user.uuid))
        await db_session.commit()


async def test_invitations_store_no_password(client, db_session):
    email = f"invite_{uuid4().hex[:8]}@example.com"
    await _create_auth_user(db_session)
    try:
        invite_uuid = await register_app_user(
            db_session,
            schemas.UserCreateAppAdmin(
                email=email,
                permissions_uuid=UUID(_AUTH_USER["perm_uuid"]),
                first_name="In",
                last_name="Vited",
            ),
            schemas.RegisterAppUser(inviting_uuid=USER_UUID),
            from_oauth=True,
        )
        data = await _scalar(
            db_session,
            "SELECT data FROM user_invite WHERE uuid = UNHEX(:uuid)",
            uuid=_hex(invite_uuid),
        )
        assert json.loads(data) == {"first_name": "In", "last_name": "Vited"}

        user_uuid = await process_create_user(invite_uuid, email, db_session)
        password = await _scalar(
            db_session,
            "SELECT password FROM `user` WHERE uuid = UNHEX(:uuid)",
            uuid=_hex(user_uuid),
        )
        assert password.startswith("$2")
    finally:
        await db_session.execute(delete(models.UserInvite).where(models.UserInvite.email == email))
        await db_session.execute(delete(User).where(User.email == email))
        await db_session.commit()


@pytest.mark.parametrize(
    ("params", "expected"),
    [({}, 900), ({"expiration": 3600}, 900), ({"expiration": 60}, 60), ({"expiration": 900}, 900)],
)
async def test_presigned_urls_are_capped(auth_client, monkeypatch, params, expected):
    requested: list[int] = []

    async def stored_file(*_args):
        return SimpleNamespace(
            uuid=uuid4(), bucket="bucket", s3_file_name="f.csv", original_file_name="f.csv"
        )

    async def create_presigned_url(_bucket, _name, expiration):
        requested.append(expiration)
        return "https://storage.example.org/f.csv?sig"

    monkeypatch.setattr(file_storage, "get_user_stored_file", stored_file)
    monkeypatch.setattr(file_storage.FileStorage, "create_presigned_url", create_presigned_url)

    response = await auth_client.get(f"/app/files/{uuid4()}/presigned-url", params=params)
    assert response.status_code == 200
    assert requested == [expected]


@pytest.mark.parametrize("expiration", [0, -1])
async def test_presigned_url_needs_a_positive_lifetime(auth_client, expiration):
    response = await auth_client.get(
        f"/app/files/{uuid4()}/presigned-url", params={"expiration": expiration}
    )
    assert response.status_code == 422
