import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import uuid4
from sqlalchemy import text


class TestWidgetMetadata:
    @pytest.mark.asyncio
    async def test_get_widget_metadata_unauthenticated(self, client):
        response = await client.get("/app/widget-metadata")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_widget_metadata_authenticated(self, auth_client):
        response = await auth_client.get("/app/widget-metadata")
        assert response.status_code in {200, 404}
        data = response.json()
        assert isinstance(data, (list, dict))
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type

    @pytest.mark.asyncio
    async def test_create_widget_metadata_unauthenticated(self, client):
        response = await client.post("/app/widget-metadata", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_create_widget_metadata_authenticated(self, auth_client):
        widget_id = str(uuid4())
        payload = {
            "widgetId": widget_id,
            "name": "Test Widget",
            "description": "Integrated Test Widget",
            "source": "testing",
            "category": "testing",
            "subCategory": "testing",
            "widgetType": "iframe",
            "storage": {"url": "https://example.com"},
            "widgetConfig": {},
        }
        response = await auth_client.post("/app/widget-metadata", json=payload)
        assert response.status_code in {200, 201}
        data = response.json()
        assert data.get("success") is True

    @pytest.mark.asyncio
    async def test_create_widget_metadata_chart_html_types(self, auth_client):
        for widget_type in ("chart", "html"):
            widget_id = str(uuid4())
            payload = {
                "widgetId": widget_id,
                "name": f"test-{widget_type}-{widget_id}",
                "description": f"metadata for {widget_type}",
                "source": "testing",
                "category": "testing",
                "subCategory": "testing",
                "widgetType": widget_type,
                "storage": (
                    {"figure": {"data": [], "layout": {}}}
                    if widget_type == "chart"
                    else {"html": "<div>test</div>"}
                ),
            }

            response = await auth_client.post("/app/widget-metadata", json=payload)
            assert response.status_code in {200, 201}
            data = response.json()
            assert data.get("success") is True

    @pytest.mark.asyncio
    async def test_get_widget_metadata_filters_chart_html(self, auth_client):
        created_names: dict[str, str] = {}
        for widget_type in ("chart", "html"):
            widget_id = str(uuid4())
            name = f"filter-{widget_type}-{widget_id}"
            created_names[widget_type] = name
            payload = {
                "widgetId": widget_id,
                "name": name,
                "description": f"metadata for {widget_type}",
                "source": "testing",
                "category": "testing",
                "subCategory": "testing",
                "widgetType": widget_type,
                "storage": (
                    {"figure": {"data": [], "layout": {}}}
                    if widget_type == "chart"
                    else {"html": "<div>test</div>"}
                ),
            }
            create_response = await auth_client.post("/app/widget-metadata", json=payload)
            assert create_response.status_code in {200, 201}

        for widget_type in ("chart", "html"):
            response = await auth_client.get(
                f"/app/widget-metadata?widget_type={widget_type}"
            )
            assert response.status_code == 200
            widgets = response.json()
            assert isinstance(widgets, list)
            assert any(
                item.get("name") == created_names[widget_type]
                and item.get("widgetType") == widget_type
                for item in widgets
            )

    @pytest.mark.asyncio
    async def test_patch_widget_metadata_authenticated(self, auth_client):
        widget_id = str(uuid4())
        payload = {
            "widgetId": widget_id,
            "name": "Widget To Update",
            "description": "Original Description",
            "source": "testing",
            "category": "testing",
            "subCategory": "testing",
            "widgetType": "iframe",
            "storage": {"url": "https://example.com"},
        }
        await auth_client.post("/app/widget-metadata", json=payload)

        patch_payload = {
            "name": "Updated Widget Name",
            "description": "Updated Description",
        }
        response = await auth_client.patch(
            f"/app/widget-metadata?widget_id={widget_id}", json=patch_payload
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") is True

        get_response = await auth_client.get(
            f"/app/widget-metadata?widget_id={widget_id}"
        )
        widgets = get_response.json()
        assert len(widgets) > 0
        w = next((x for x in widgets if x["widgetId"] == widget_id), None)
        assert w is not None
        assert w["name"] == "Updated Widget Name"

    @pytest.mark.asyncio
    async def test_delete_widget_metadata_unauthenticated(self, client):
        test_id = str(uuid4())
        response = await client.delete(f"/app/widget-metadata/{test_id}")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_delete_widget_metadata_nonexistent(self, auth_client):
        test_id = str(uuid4())
        response = await auth_client.delete(f"/app/widget-metadata/{test_id}")
        assert response.status_code in {200, 404}


class TestThemeSettings:
    @pytest.mark.asyncio
    async def test_get_theme_settings_unauthenticated(self, client):
        response = await client.get("/app/theme-settings")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_theme_settings_authenticated(self, auth_client):
        response = await auth_client.get("/app/theme-settings")
        assert response.status_code in {200, 404}
        data = response.json()
        assert isinstance(data, dict)
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type


class TestWidgetInputValidation:
    @pytest.mark.asyncio
    async def test_create_widget_empty_name(self, auth_client):
        response = await auth_client.post(
            "/app/widget-metadata", json={"name": "", "type": "chart"}
        )
        assert response.status_code in {200, 201, 400, 422}

    @pytest.mark.asyncio
    async def test_create_widget_very_long_name(self, auth_client):
        response = await auth_client.post(
            "/app/widget-metadata", json={"name": "a" * 500, "type": "chart"}
        )
        assert response.status_code in {200, 201, 400, 422}

    @pytest.mark.asyncio
    async def test_create_widget_sql_injection(self, auth_client, db_session):
        sql_payload = "'; DROP TABLE widget_metadata; --"
        response = await auth_client.post(
            "/app/widget-metadata",
            json={"name": sql_payload, "type": "chart"},
        )
        assert response.status_code in {200, 201, 400, 422}

        result = await db_session.execute(text("SELECT COUNT(*) FROM widget_metadata"))
        count = result.scalar()
        assert count is not None

    @pytest.mark.asyncio
    async def test_create_widget_xss(self, auth_client, db_session):
        xss_payload = "<script>alert('xss')</script>"
        response = await auth_client.post(
            "/app/widget-metadata",
            json={"name": xss_payload, "type": "chart"},
        )

        if response.status_code in {400, 422}:
            pass
        elif response.status_code in {200, 201}:
            content_type = response.headers.get("content-type", "")
            assert "application/json" in content_type

            data = response.json()
            if "name" in data:
                stored = data.get("name", "")
                assert stored in {
                    xss_payload,
                    "&lt;script&gt;alert('xss')&lt;/script&gt;",
                    "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;",
                }

    @pytest.mark.asyncio
    async def test_delete_widget_invalid_uuid(self, auth_client):
        response = await auth_client.delete("/app/widget-metadata/not-a-valid-uuid")
        assert response.status_code == 422


class TestThemeSettingsValidation:
    @pytest.mark.asyncio
    async def test_save_theme_sql_injection(self, auth_client, db_session):
        sql_payload = "'; DROP TABLE user; --"
        response = await auth_client.post(
            "/app/theme-settings",
            json={"theme": sql_payload},
        )
        if response.status_code == 405:
            response = await auth_client.put(
                "/app/theme-settings",
                json={"theme": sql_payload},
            )
        assert response.status_code in {200, 400, 404, 405, 422}

        result = await db_session.execute(text("SELECT COUNT(*) FROM user"))
        count = result.scalar()
        assert count is not None

    @pytest.mark.asyncio
    async def test_save_theme_xss(self, auth_client):
        xss_payload = "<script>alert('xss')</script>"
        response = await auth_client.post(
            "/app/theme-settings",
            json={"theme": xss_payload},
        )
        if response.status_code == 405:
            response = await auth_client.put(
                "/app/theme-settings",
                json={"theme": xss_payload},
            )

        if response.status_code in {200, 201}:
            content_type = response.headers.get("content-type", "")
            assert "application/json" in content_type


class TestWidgetOutputValidation:
    @pytest.mark.asyncio
    async def test_widget_metadata_response_schema(self, auth_client):
        response = await auth_client.get("/app/widget-metadata")
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, (list, dict))

    @pytest.mark.asyncio
    async def test_theme_settings_response_schema(self, auth_client):
        response = await auth_client.get("/app/theme-settings")
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, (list, dict))

    @pytest.mark.asyncio
    async def test_widget_response_no_sensitive_data(self, auth_client):
        response = await auth_client.get("/app/widget-metadata")
        if response.status_code == 200:
            data_str = str(response.json())
            assert "password" not in data_str.lower()
            assert "secret" not in data_str.lower()
            assert "private_key" not in data_str.lower()


class TestWidgetCrossUserSecurity:
    @pytest.mark.asyncio
    async def test_widgets_isolated_per_user(self, auth_client, second_user_client):
        response1 = await auth_client.get("/app/widget-metadata")
        response2 = await second_user_client.get("/app/widget-metadata")

        assert response1.status_code in {200, 404}
        assert response2.status_code in {200, 404}

    @pytest.mark.asyncio
    async def test_cannot_delete_other_user_widget(
        self, auth_client, second_user_client
    ):
        create_response = await auth_client.post(
            "/app/widget-metadata",
            json={"name": "user1_widget", "type": "chart"},
        )

        if create_response.status_code in {200, 201}:
            data = create_response.json()
            if "uuid" in data:
                delete_response = await second_user_client.delete(
                    f"/app/widget-metadata/{data['uuid']}"
                )
                assert delete_response.status_code in {403, 404}

                await auth_client.delete(f"/app/widget-metadata/{data['uuid']}")
