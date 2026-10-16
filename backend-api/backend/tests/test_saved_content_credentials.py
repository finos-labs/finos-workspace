"""Saved dashboards and apps never keep a data backend's credentials.

Widgets look a backend's headers up when they fetch; the content the API stores loses the
headers and query values of every widget endpoint, and any backend header rows, whatever
the client sends.
"""

import json
from uuid import uuid4

import pytest
from sqlalchemy import delete, select

from api import models
from api.schemas import strip_endpoint_credentials

SECRET = "sk-data-backend-key"


def _widget(name: str) -> dict:
    return {
        "i": name,
        "name": name,
        "endpoint": {
            "url": "http://localhost:8001/widgets/prices",
            "method": "GET",
            "headers": {"X-Api-Key": SECRET},
            "query": {"apikey": SECRET},
        },
        "endpointHeaders": [{"key": "X-Api-Key", "value": SECRET, "location": "headers"}],
        "params": [{"name": "ticker", "value": "AAPL"}],
    }


def test_stripping_keeps_everything_but_the_credentials():
    content = {
        "name": "Markets",
        "tabs": {"overview": {"layout": [_widget("a")], "widgets": {"b": _widget("b")}}},
    }
    stripped = strip_endpoint_credentials(content)

    assert SECRET not in json.dumps(stripped)
    widget = stripped["tabs"]["overview"]["layout"][0]
    assert widget["endpoint"] == {
        "url": "http://localhost:8001/widgets/prices",
        "method": "GET",
    }
    assert widget["params"] == [{"name": "ticker", "value": "AAPL"}]
    assert stripped["tabs"]["overview"]["widgets"]["b"]["endpoint"]["method"] == "GET"
    # Nothing else is touched
    assert strip_endpoint_credentials({"name": "x", "headers": {"a": "b"}}) == {
        "name": "x",
        "headers": {"a": "b"},
    }


@pytest.mark.asyncio
async def test_a_saved_dashboard_keeps_no_backend_credentials(auth_client, db_session):
    dashboard_uuid = uuid4()
    content = {"name": "Markets", "tabs": {"overview": {"layout": [_widget("a")]}}}
    try:
        response = await auth_client.post(
            "/app/dash/sync", json={"items": {str(dashboard_uuid): content}}
        )
        assert response.status_code == 200, response.text

        stored = (
            await db_session.execute(
                select(models.DashboardItem.content).where(
                    models.DashboardItem.uuid == dashboard_uuid
                )
            )
        ).scalar_one()
        assert SECRET not in json.dumps(stored)
        assert stored["tabs"]["overview"]["layout"][0]["endpoint"]["url"].endswith("/prices")
    finally:
        await db_session.execute(
            delete(models.DashboardItem).where(models.DashboardItem.uuid == dashboard_uuid)
        )
        await db_session.commit()


@pytest.mark.asyncio
async def test_a_saved_app_keeps_no_backend_credentials(auth_client, db_session):
    app_uuid = uuid4()
    try:
        response = await auth_client.post(
            f"/app/user-apps/{app_uuid}",
            json={"name": "Markets app", "widgets": [_widget("a")], "groups": []},
        )
        assert response.status_code == 200, response.text
        assert SECRET not in response.text

        stored = (
            await db_session.execute(
                select(models.UserApp.content).where(models.UserApp.uuid == app_uuid)
            )
        ).scalar_one()
        assert SECRET not in json.dumps(stored)
        assert stored["widgets"][0]["endpoint"]["method"] == "GET"
    finally:
        await db_session.execute(delete(models.UserApp).where(models.UserApp.uuid == app_uuid))
        await db_session.commit()
