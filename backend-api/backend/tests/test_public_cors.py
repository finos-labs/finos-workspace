"""Tests for the public-path CORS middleware.

These verify that the explicitly whitelisted public endpoints reflect `*` for
any origin (including localhost) and answer the CORS preflight directly, while
every other path is left untouched for the global CORSMiddleware to handle. A
`*` never goes out with `Access-Control-Allow-Credentials`: the web app fetches
the public listing without credentials.
"""

import pytest
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from api.auth_helpers import PublicCORSMiddleware


def _routes() -> list[Route]:
    async def marketplace_apps(_request):
        return JSONResponse([])

    async def other(_request):
        return JSONResponse({})

    return [
        Route("/marketplace/apps", marketplace_apps, methods=["GET", "OPTIONS"]),
        Route("/app/secret", other, methods=["GET", "OPTIONS"]),
    ]


def _build_app() -> Starlette:
    app = Starlette(routes=_routes())
    app.add_middleware(PublicCORSMiddleware)
    return app


class TestPublicCORSMiddleware:
    def test_preflight_public_path_allows_any_origin(self):
        client = TestClient(_build_app())
        resp = client.options(
            "/marketplace/apps",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "*"
        assert "GET" in resp.headers["access-control-allow-methods"]

    def test_get_public_path_sets_cors_header(self):
        client = TestClient(_build_app())
        resp = client.get(
            "/marketplace/apps",
            headers={"Origin": "http://localhost:3000"},
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "*"

    def test_non_public_path_untouched(self):
        client = TestClient(_build_app())
        resp = client.get(
            "/app/secret",
            headers={"Origin": "http://localhost:3000"},
        )
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers


CLIENT_ORIGIN = "http://localhost:3000"


def _build_api() -> Starlette:
    """The public listing behind the API's global CORS, as main.py stacks them."""
    app = Starlette(routes=_routes())
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[CLIENT_ORIGIN],
        allow_credentials=True,
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )
    app.add_middleware(PublicCORSMiddleware)
    return app


class TestThePublicListingBehindTheGlobalCORS:
    @pytest.mark.parametrize("origin", [CLIENT_ORIGIN, "http://localhost:8501"])
    def test_any_origins_preflight_is_answered_without_credentials(self, origin):
        resp = TestClient(_build_api()).options(
            "/marketplace/apps",
            headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "*"
        assert "access-control-allow-credentials" not in resp.headers

    @pytest.mark.parametrize("origin", [CLIENT_ORIGIN, "http://localhost:8501"])
    def test_a_star_never_goes_out_with_credentials(self, origin):
        resp = TestClient(_build_api()).get("/marketplace/apps", headers={"Origin": origin})
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "*"
        assert "access-control-allow-credentials" not in resp.headers

    def test_the_clients_own_paths_keep_their_credentials(self):
        resp = TestClient(_build_api()).get("/app/secret", headers={"Origin": CLIENT_ORIGIN})
        assert resp.headers["access-control-allow-origin"] == CLIENT_ORIGIN
        assert resp.headers["access-control-allow-credentials"] == "true"
