"""A plugin with a backend, a stand-in for the backend the deployer would run, and a
Workspace backend it may read through the broker, for the tests of T2
(docs/widget-plugins/SERVER-SIDE.md 5).

The stand-in speaks the RPC of SERVER-SIDE 5.6 over plain HTTP on 127.0.0.1, as a backend
on the deployment's private network does. It answers its identity from ``identity``,
which a test sets to what was approved, and each route call with ``route_answer``.
"""

import json
from dataclasses import dataclass, field
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete

from api import models
from api.widget_plugins import backends
from tests.fixtures.upstream import Answer, Received, Upstream
from tests.fixtures.widget_plugins import (
    ADMIN,
    ADMIN_ENTITY,
    approve,
    enable,
    manifest,
    plugin_view,
    rescan,
    version_view,
    write_package,
)
from utilities.config import settings

BACKEND_SECRET = "route-key-for-the-test"  # noqa: S105 - a test value
SOURCE_SECRET = "source-key-for-the-test"  # noqa: S105 - a test value
ROUTE_CALL = "/app/widget-plugins/test-chart/backend/forecast"


def backend_manifest(**changes) -> dict:
    data = manifest()
    data["secrets"] = [{"name": "api_key", "purpose": "Authenticates the backend to its forecast model"}]
    data["dataSources"] = [{"id": "sales", "purpose": "The sales of the user's organization"}]
    data["identity"] = "pseudonymous"
    data["server"] = {
        "backend": {
            "protocol": 1,
            "routes": [
                {
                    "id": "forecast",
                    "args": {"region": {"type": "string", "maxLength": 8, "required": True}},
                    "secrets": ["api_key"],
                    "response": {"timeoutMs": 1000},
                }
            ],
        }
    }
    widget = data["contributes"]["widgets"][0]
    widget["permissions"] = [*widget["permissions"], "core:backend:call"]
    widget["server"] = {"routes": ["forecast"]}
    data.update(changes)
    return data


@dataclass
class FakeBackend:
    """What the stand-in answers, and what it received."""

    server: Upstream
    identity: dict = field(default_factory=dict)
    route_answer: Answer = field(default_factory=lambda: Answer(body=b'{"forecast": [1, 2, 3]}'))

    @property
    def calls(self) -> list[Received]:
        return [r for r in self.server.received if r.target.startswith("/.workspace/routes/")]

    def answer(self, received: Received) -> Answer:
        if received.target == "/.workspace/identity":
            return Answer(body=json.dumps(self.identity).encode())
        if received.target == "/.workspace/health":
            return Answer(body=b'{"ok": true}')
        return self.route_answer


@pytest.fixture
async def plugin_backend(monkeypatch):
    """The stand-in, listed in WIDGET_PLUGIN_BACKENDS for test-chart."""
    backends.reset()
    fake = FakeBackend(server=Upstream())
    fake.server.answer = fake.answer
    async with fake.server:
        monkeypatch.setattr(settings, "WIDGET_PLUGIN_BACKENDS", {"test-chart": f"http://127.0.0.1:{fake.server.port}"})
        yield fake
    backends.reset()


async def ready_backend(superuser, plugins_dir, backend: FakeBackend, *, secret: bool = True, **changes) -> dict:
    """Discover, approve and enable the plugin for everyone, set its secret, and have the
    stand-in answer the approved version's identity. Returns the version's view."""
    write_package(plugins_dir, backend_manifest(**changes))
    await rescan(superuser)
    await approve(superuser)
    await enable(superuser, access_mode="everyone")
    if secret:
        response = await superuser.put("/plugins/test-chart/secrets/api_key", json={"value": BACKEND_SECRET})
        assert response.status_code == 200, response.text
    view = version_view(await plugin_view(superuser))
    backend.identity = {"plugin": "test-chart", "version": "1.0.0", "digest": view["digest"], "protocol": 1}
    return view


@dataclass
class DataSource:
    server: Upstream
    uuid: UUID


@pytest.fixture
async def data_source(db_session):
    """A backend of the admin's entity, with credentials in a header and in the query."""
    server = Upstream(answer=lambda _r: Answer(body=b'{"rows": [{"region": "emea", "sales": 10}]}'))
    async with server:
        source = models.ApiSource(
            uuid=uuid4(),
            name="Sales",
            url=f"http://127.0.0.1:{server.port}/api",
            user_uuid=ADMIN,
            entity_uuid=ADMIN_ENTITY,
            endpointHeaders=[
                {"key": "X-Api-Key", "value": SOURCE_SECRET, "location": "headers"},
                {"key": "token", "value": SOURCE_SECRET, "location": "query"},
            ],
        )
        db_session.add(source)
        await db_session.commit()
        yield DataSource(server=server, uuid=source.uuid)
        await db_session.execute(delete(models.ApiSource).where(models.ApiSource.uuid == source.uuid))
        await db_session.commit()
