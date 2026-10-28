import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from api.auth_helpers import NoStoreMiddleware
from tests.fixtures.base import bearer_client


class TestTheApi:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "path",
        [
            "/app/user",
            "/app/session",
            "/app/data-connectors/api-source",
            "/app/custom-copilot",
        ],
    )
    async def test_answers_to_the_web_app_are_never_stored(self, auth_client, path):
        response = await auth_client.get(path)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"

    @pytest.mark.asyncio
    async def test_a_local_mcp_servers_headers_are_never_stored(self, auth_client):
        local = "http://localhost:8123/mcp"
        server = {"id": "local", "name": "Local", "url": local, "enabled": True}
        response = await auth_client.post(
            "/app/mcp-servers",
            json={"servers": [{**server, "customHeaders": {"X-Local": "local-value"}}]},
        )
        assert response.status_code == 200, response.text

        response = await auth_client.post("/app/mcp-servers/local-headers", json={"url": local})
        assert response.json() == {"headers": {"X-Local": "local-value"}}
        assert response.headers["cache-control"] == "no-store"

    @pytest.mark.asyncio
    async def test_refusals_are_never_stored_either(self, client):
        response = await client.get("/app/user", headers={"Cookie": "__Host-ws_session=x"})
        assert response.status_code == 401
        assert response.headers["cache-control"] == "no-store"

    @pytest.mark.asyncio
    async def test_answers_to_a_bearer_are_never_stored(self, client):
        async with bearer_client("not-a-session") as bearer:
            response = await bearer.get("/admin/role")
        assert response.status_code == 401
        assert response.headers["cache-control"] == "no-store"

    @pytest.mark.asyncio
    async def test_answers_without_credentials_are_left_alone(self, client):
        response = await client.get("/health")
        assert response.status_code == 200
        assert "cache-control" not in response.headers


def _app() -> Starlette:
    async def own(_request):
        return JSONResponse({}, headers={"Cache-Control": "private, max-age=60"})

    async def plain(_request):
        return JSONResponse({})

    app = Starlette(routes=[Route("/own", own), Route("/plain", plain)])
    app.add_middleware(NoStoreMiddleware)
    return app


class TestTheMiddleware:
    @pytest.mark.parametrize(
        "credential",
        [
            {"Cookie": "a=b"},
            {"Authorization": "Bearer x"},
            {"X-Workspace-Authorization": "Bearer x"},
            {"X-Metering-Authorization": "Bearer x"},
        ],
    )
    def test_every_credential_counts(self, credential):
        response = TestClient(_app()).get("/plain", headers=credential)
        assert response.headers["cache-control"] == "no-store"

    def test_a_route_keeps_its_own_cache_control(self):
        response = TestClient(_app()).get("/own", headers={"Cookie": "a=b"})
        assert response.headers["cache-control"] == "private, max-age=60"
