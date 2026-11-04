from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from api import auth_helpers
from tests.fixtures.base import TEST_BASE_URL, TEST_ORIGIN, app

REFUSED = {"detail": "Requests must come from an allowed origin"}
PATHS = [
    ("get", "/"),
    ("post", "/app/login"),
    ("get", "/app/user"),
    ("put", "/app/usage"),
    ("post", "/app/copilot/authorize"),
    ("get", "/admin/users"),
    ("get", "/entity/entity"),
    ("get", "/app/files/presigned/a.pdf?Expires=1&Signature=x"),
    ("post", "/mcp"),
]


async def _send(method: str, path: str, headers: dict[str, str]):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=TEST_BASE_URL, headers=headers
    ) as caller:
        return await getattr(caller, method)(path)


class TestTheRule:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(("method", "path"), PATHS)
    @pytest.mark.parametrize(
        "headers",
        [
            {},
            {"Origin": "https://elsewhere.example"},
            {"Origin": "null"},
            {"Authorization": "Bearer anything", "X-Workspace-Client": "web"},
        ],
    )
    async def test_no_allowed_origin_is_refused(self, method, path, headers):
        response = await _send(method, path, headers)

        assert response.status_code == 403
        assert response.json() == REFUSED

    @pytest.mark.asyncio
    async def test_an_allowed_origin_passes(self):
        response = await _send("get", "/app/validate", {"Origin": TEST_ORIGIN})

        assert response.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", ["/health", "/healthz"])
    @pytest.mark.parametrize("headers", [{}, {"Origin": "https://elsewhere.example"}])
    async def test_the_health_checks_need_no_origin(self, path, headers):
        response = await _send("get", path, headers)

        assert response.status_code == 200
        assert response.json() == {"success": True}

    @pytest.mark.asyncio
    async def test_an_origin_the_pattern_matches_passes(self):
        with patch.object(
            auth_helpers.settings,
            "BACKEND_CORS_ORIGIN_REGEX",
            r"https://pr-[0-9]+\.example",
        ):
            allowed = await _send(
                "get", "/app/validate", {"Origin": "https://pr-12.example"}
            )
            refused = await _send(
                "get", "/app/validate", {"Origin": "https://pr-12.example.evil"}
            )

        assert allowed.status_code == 200
        assert refused.status_code == 403

    @pytest.mark.asyncio
    async def test_a_preflight_from_another_origin_is_refused(self):
        response = await _send(
            "options",
            "/app/user",
            {"Origin": "https://elsewhere.example", "Access-Control-Request-Method": "GET"},
        )

        assert response.status_code == 403
        assert "access-control-allow-origin" not in response.headers


class TestTheWebsocket:
    @pytest.mark.parametrize("headers", [{}, {"origin": "https://elsewhere.example"}])
    def test_a_websocket_without_an_allowed_origin_is_refused(self, headers):
        browser = TestClient(app)
        with (
            pytest.raises(WebSocketDisconnect) as refusal,
            browser.websocket_connect("/app/workspace-mcp/bridge/ws", headers=headers),
        ):
            pass

        assert refusal.value.code == 1008
