import json

import pytest
from sqlalchemy import update

from api import auth_helpers, frame_proxy, models, source_proxy, widget_access
from tests.fixtures.plugin_backends import SOURCE_SECRET
from tests.fixtures.upstream import Answer

CATALOG = {
    "sales": {"name": "Sales", "endpoint": "/sales"},
    "hr": {"name": "HR", "endpoint": "/hr/{team}", "params": [{"paramName": "team", "type": "text"}]},
    "framed": {"name": "Framed", "type": "iframe", "endpoint": "/dash/index.html", "requires_auth": True},
    "other_frame": {"name": "Other", "type": "iframe", "endpoint": "/other/index.html", "requires_auth": True},
}
APPS = [{"name": "App", "img": "/static/app.png"}]


def serve(received):
    path = received.target.split("?", 1)[0]
    if path == "/api/widgets.json":
        return Answer(body=json.dumps(CATALOG).encode())
    if path == "/api/apps.json":
        return Answer(body=json.dumps(APPS).encode())
    if path == "/api/templates.json":
        return Answer(status=404)
    return Answer(body=b'{"rows": [{"region": "emea"}]}')


@pytest.fixture
def source(data_source):
    data_source.server.answer = serve
    return data_source


@pytest.fixture(autouse=True)
def fresh_state():
    for state in (
        source_proxy._json_cache,
        source_proxy._json_pending,
        source_proxy._decisions,
        source_proxy._breakers,
        source_proxy._awaiting,
        source_proxy._host_machine,
        frame_proxy._access,
        widget_access._tables,
    ):
        state.clear()
    source_proxy._limiter_down_until = 0.0
    yield


@pytest.fixture(autouse=True)
async def fresh_rates():
    async with auth_helpers.app_redis() as redis:
        keys = [key async for key in redis.scan_iter(match="*proxy-rate:*")]
        if keys:
            await redis.delete(*keys)
    yield


def route(source) -> str:
    return f"/app/data-connectors/api-source/{source.uuid}/request"


def call(client, source, path: str, method: str = "GET", **fields):
    return client.post(
        route(source), json={"url": f"http://127.0.0.1:{source.server.port}{path}", "method": method, **fields}
    )


def data_requests(source) -> list[str]:
    return [r.target.split("?", 1)[0] for r in source.server.received if not r.target.split("?", 1)[0].endswith(".json")]


async def grant(
    member, db_session, source, widgets: dict[str, str] | None, name: str = "Readers", access: str = "access"
):
    role = await member.role(name)
    listed = None if widgets is None else [{"widgetId": key, "access": value} for key, value in widgets.items()]
    db_session.add(models.RoleBackend(role_uuid=role, backend_uuid=source.uuid, access=access, widgets=listed))
    await db_session.commit()
    return role


class TestTheRoutesOfTheWidgetsARoleGrants:
    @pytest.mark.asyncio
    async def test_a_granted_widgets_route_is_called_with_the_credentials(self, member, source, db_session):
        await grant(member, db_session, source, {"sales": "access"})

        response = await call(member, source, "/api/sales?region=emea")

        assert response.status_code == 200, response.text
        assert response.json() == {"rows": [{"region": "emea"}]}
        assert data_requests(source) == ["/api/sales"]
        assert source.server.received[-1].headers["x-api-key"] == SOURCE_SECRET

    @pytest.mark.asyncio
    async def test_the_route_of_a_widget_no_role_grants_is_not_called(self, member, source, db_session):
        await grant(member, db_session, source, {"sales": "access"})

        response = await call(member, source, "/api/hr/emea")

        assert response.status_code == 403, response.text
        assert response.headers["x-workspace-proxy-error"] == "1"
        assert "none of your roles" in response.json()["detail"]
        assert data_requests(source) == []

    @pytest.mark.asyncio
    async def test_a_widget_a_role_marks_no_access_is_not_granted(self, member, source, db_session):
        await grant(member, db_session, source, {"sales": "no-access", "hr": "access"})

        assert (await call(member, source, "/api/sales")).status_code == 403
        assert (await call(member, source, "/api/hr/emea")).status_code == 200

    @pytest.mark.asyncio
    async def test_the_widgets_of_all_the_users_roles_add_up(self, member, source, db_session):
        await grant(member, db_session, source, {"sales": "access"}, "Sales readers")
        await grant(member, db_session, source, {"hr": "access"}, "HR readers")

        assert (await call(member, source, "/api/sales")).status_code == 200
        assert (await call(member, source, "/api/hr/emea")).status_code == 200
        assert (await call(member, source, "/api/secret")).status_code == 403

    @pytest.mark.asyncio
    async def test_a_role_for_the_connection_as_a_whole_grants_no_widget(self, member, source, db_session):
        await grant(member, db_session, source, None)

        assert (await call(member, source, "/api/sales")).status_code == 403
        assert (await call(member, source, "/api/sales/anything")).status_code == 403

    @pytest.mark.asyncio
    async def test_a_route_that_no_widget_declares_is_not_called(self, member, source, db_session):
        await grant(member, db_session, source, {"sales": "access", "hr": "access"})

        for path in ("/api/admin/users", "/api/sales/extra", "/other/sales", "/api"):
            assert (await call(member, source, path)).status_code == 403, path
        assert data_requests(source) == []

    @pytest.mark.asyncio
    async def test_a_method_the_widget_does_not_declare_is_not_called(self, member, source, db_session):
        await grant(member, db_session, source, {"sales": "access"})

        for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"):
            assert (await call(member, source, "/api/sales", method)).status_code == 403, method
        assert data_requests(source) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "path",
        ["/api/sales/../secret", "/api/sales/%2e%2e/secret", "/api/./sales", "/api//sales", "/api/sales%5C..%5Csecret"],
    )
    async def test_a_path_that_climbs_to_another_route_is_not_called(self, member, source, db_session, path):
        await grant(member, db_session, source, {"sales": "access"})

        assert (await call(member, source, path)).status_code in {400, 403, 422}
        assert data_requests(source) == []

    @pytest.mark.asyncio
    async def test_the_catalog_of_the_connection_needs_no_widget(self, member, source, db_session):
        await grant(member, db_session, source, None)

        for name in ("widgets.json", "apps.json", "templates.json"):
            response = await call(member, source, f"/api/{name}")
            assert response.status_code in {200, 404}, (name, response.text)
        assert (await call(member, source, "/api/widgets.json")).json() == CATALOG
        assert (await call(member, source, "/api/static/app.png")).status_code == 200
        assert (await call(member, source, "/api/static/other.png")).status_code == 403

    @pytest.mark.asyncio
    async def test_the_connection_that_cannot_say_what_it_declares_calls_nothing(self, member, source, db_session):
        await grant(member, db_session, source, {"sales": "access"})
        source.server.answer = lambda _r: Answer(status=500, body=b"broken")

        response = await call(member, source, "/api/sales")

        assert response.status_code == 502, response.text
        assert response.headers["x-workspace-proxy-error"] == "1"
        assert data_requests(source) == []

    @pytest.mark.asyncio
    async def test_the_users_own_connection_is_not_limited_by_roles(self, superuser, source):
        for path in ("/api/sales", "/api/hr/emea", "/api/undeclared/route"):
            assert (await call(superuser, source, path)).status_code == 200, path

    @pytest.mark.asyncio
    async def test_a_connection_the_user_cannot_read_stays_unfound(self, member, source, db_session):
        await db_session.execute(
            update(models.ApiSource).where(models.ApiSource.uuid == source.uuid).values(entity_uuid=None)
        )
        await db_session.commit()

        assert (await call(member, source, "/api/sales")).status_code == 404

    @pytest.mark.asyncio
    async def test_a_widget_taken_away_is_noticed_when_the_decision_expires(
        self, member, source, db_session, monkeypatch
    ):
        monkeypatch.setattr(source_proxy, "DECISION_SECONDS", 0.0)
        role = await grant(member, db_session, source, {"sales": "access"})
        assert (await call(member, source, "/api/sales")).status_code == 200

        await db_session.execute(
            update(models.RoleBackend)
            .where(models.RoleBackend.role_uuid == role)
            .values(widgets=[{"widgetId": "sales", "access": "no-access"}])
        )
        await db_session.commit()

        assert (await call(member, source, "/api/sales")).status_code == 403

    @pytest.mark.asyncio
    async def test_who_may_use_which_widget_is_worked_out_once_for_many_calls(
        self, member, source, db_session, monkeypatch
    ):
        asked = []
        original = widget_access.granted_widgets

        async def counting(*args):
            asked.append(1)
            return await original(*args)

        monkeypatch.setattr(widget_access, "granted_widgets", counting)
        await grant(member, db_session, source, {"sales": "access"})
        for _ in range(4):
            assert (await call(member, source, "/api/sales")).status_code == 200
        assert len(asked) == 1

    @pytest.mark.asyncio
    async def test_what_a_connection_declares_is_read_once_for_many_calls(self, member, source, db_session):
        await grant(member, db_session, source, {"sales": "access"})
        for _ in range(4):
            assert (await call(member, source, "/api/sales")).status_code == 200
        reads = [r for r in source.server.received if r.target.split("?", 1)[0] == "/api/widgets.json"]
        assert len(reads) == 1


class TestAFramedPageOfAWidgetARoleGrants:
    @pytest.mark.asyncio
    async def test_only_a_granted_widget_gets_a_token(self, member, source, db_session):
        await grant(member, db_session, source, {"framed": "access"})
        url = f"/app/data-connectors/api-source/{source.uuid}/frame"

        assert (await member.post(url, json={"widgetId": "framed"})).status_code == 200
        refused = await member.post(url, json={"widgetId": "other_frame"})
        assert refused.status_code == 403
        assert "none of your roles" in refused.json()["detail"]

    @pytest.mark.asyncio
    async def test_a_token_stops_working_when_its_widget_is_taken_away(self, member, source, db_session, monkeypatch):
        role = await grant(member, db_session, source, {"framed": "access"})
        url = f"/app/data-connectors/api-source/{source.uuid}/frame"
        token = (await member.post(url, json={"widgetId": "framed"})).json()["token"]
        page = f"/app/data-connectors/frame/{token}/api/dash/index.html"
        assert (await member.get(page)).status_code == 200

        monkeypatch.setattr(frame_proxy, "ACCESS_SECONDS", 0.0)
        await db_session.execute(
            update(models.RoleBackend)
            .where(models.RoleBackend.role_uuid == role)
            .values(widgets=[{"widgetId": "framed", "access": "no-access"}])
        )
        await db_session.commit()

        assert (await member.get(page)).status_code == 403

    @pytest.mark.asyncio
    async def test_the_owner_may_open_any_page(self, superuser, source):
        url = f"/app/data-connectors/api-source/{source.uuid}/frame"
        assert (await superuser.post(url, json={"widgetId": "other_frame"})).status_code == 200
