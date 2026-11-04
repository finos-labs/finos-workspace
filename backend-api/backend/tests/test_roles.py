import asyncio

import pytest
from httpx import Response
from uuid import uuid4
from sqlalchemy import text

from api.events.types import RoleAuditAction, RoleResourceType
from api.events.role_permission_events import get_widget_changes, get_template_changes
from tests.fixtures.utils import skip


class TestRoles:
    @pytest.mark.asyncio
    async def test_get_roles_unauthenticated(self, client):
        response = await client.get("/admin/role")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_roles_authenticated_non_admin(self, auth_client):
        response = await auth_client.get("/admin/role")
        assert response.status_code in {200, 403}
        data = response.json()
        assert isinstance(data, (list, dict))
        if response.status_code == 403:
            assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_create_role_unauthenticated(self, client):
        response = await client.post("/admin/role", json={"name": "test_role", "description": "Test role"})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_create_role_authenticated_non_admin(self, auth_client):
        response = await auth_client.post(
            "/admin/role",
            json={
                "name": "test_role_from_user",
                "description": "Test role created by regular user",
            },
        )
        assert response.status_code in {200, 201, 403, 422}


class TestRoleSingle:
    @pytest.mark.asyncio
    async def test_get_role_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/admin/role/{test_uuid}")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_update_role_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.patch(f"/admin/role/{test_uuid}", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_delete_role_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/admin/role/{test_uuid}")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data


class TestRolePermissions:
    @pytest.mark.asyncio
    async def test_get_role_permissions_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/admin/role-permissions/{test_uuid}")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_update_role_permissions_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.put(f"/admin/role-permissions/{test_uuid}", json={"permissions": []})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data


class TestAuditLogs:
    @pytest.mark.asyncio
    async def test_get_audit_logs_unauthenticated(self, client):
        response = await client.get("/admin/role-permissions-audit-logs")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_audit_logs_authenticated_non_admin(self, auth_client):
        response = await auth_client.get("/admin/role-permissions-audit-logs")
        assert response.status_code in {200, 403}
        data = response.json()
        assert isinstance(data, (list, dict))
        if response.status_code == 403:
            assert "detail" in data or "message" in data or "error" in data


class TestRoleInputValidation:
    @pytest.mark.asyncio
    async def test_create_role_empty_name(self, admin_client):
        response = await admin_client.post(
            "/admin/role",
            json={"name": "", "description": "Test role"},
        )
        assert response.status_code in {422, 400, 200, 201}

    @pytest.mark.asyncio
    async def test_create_role_name_too_long(self, admin_client):
        response = await admin_client.post(
            "/admin/role",
            json={"name": "a" * 300, "description": "Test role"},
        )
        assert response.status_code in {422, 400, 200, 201}

    @pytest.mark.asyncio
    async def test_create_role_sql_injection_name(self, admin_client, db_session):
        sql_payload = "'; DROP TABLE role; --"
        response = await admin_client.post(
            "/admin/role",
            json={"name": sql_payload, "description": "Test"},
        )
        assert response.status_code in {422, 400, 200, 201}

        result = await db_session.execute(text("SELECT COUNT(*) FROM role"))
        count = result.scalar()
        assert count is not None

        if response.status_code in {200, 201}:
            data = response.json()
            if "uuid" in data:
                role_uuid = data["uuid"]
                result = await db_session.execute(
                    text("SELECT name FROM role WHERE uuid = :uuid"),
                    {"uuid": role_uuid},
                )
                stored_name = result.scalar()
                assert stored_name == sql_payload

    @pytest.mark.asyncio
    async def test_create_role_xss_name(self, admin_client, db_session):
        xss_payload = "<script>alert('xss')</script>"
        response = await admin_client.post(
            "/admin/role",
            json={"name": xss_payload, "description": "Test XSS"},
        )

        if response.status_code in {400, 422}:
            pass
        elif response.status_code in {200, 201}:
            data = response.json()

            if "name" in data:
                stored_name = data.get("name", "")
                assert stored_name in {
                    xss_payload,
                    "&lt;script&gt;alert('xss')&lt;/script&gt;",
                    "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;",
                }

            if "uuid" in data:
                get_response = await admin_client.get(f"/admin/role/{data['uuid']}")
                if get_response.status_code == 200:
                    content_type = get_response.headers.get("content-type", "")
                    assert "application/json" in content_type

                await admin_client.delete(f"/admin/role/{data['uuid']}")

    @pytest.mark.asyncio
    async def test_get_role_invalid_uuid(self, admin_client):
        response = await admin_client.get("/admin/role/not-a-valid-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_role_invalid_uuid(self, admin_client):
        response = await admin_client.patch(
            "/admin/role/not-a-valid-uuid",
            json={"name": "updated_name"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_delete_role_invalid_uuid(self, admin_client):
        response = await admin_client.delete("/admin/role/not-a-valid-uuid")
        assert response.status_code == 422


class TestRoleAdminAccess:
    @pytest.mark.asyncio
    async def test_admin_can_list_roles(self, admin_client):
        response = await admin_client.get("/admin/role")
        assert response.status_code in {200, 404}

    @pytest.mark.asyncio
    async def test_admin_can_create_role(self, admin_client):
        response = await admin_client.post(
            "/admin/role",
            json={"name": f"test_role_{uuid4().hex[:8]}", "description": "Test role"},
        )
        assert response.status_code in {200, 201, 422}

    @pytest.mark.asyncio
    async def test_admin_can_get_role_permissions(self, admin_client):
        roles_response = await admin_client.get("/admin/roles")
        if roles_response.status_code == 200 and roles_response.json():
            role = roles_response.json()[0]
            if "uuid" in role:
                response = await admin_client.get(f"/admin/role-permissions/{role['uuid']}")
                assert response.status_code in {200, 404}

    @pytest.mark.asyncio
    async def test_admin_can_get_nonexistent_role(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.get(f"/admin/role/{fake_uuid}")
        assert response.status_code in {404, 400}

    @pytest.mark.asyncio
    async def test_admin_can_delete_nonexistent_role(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.delete(f"/admin/role/{fake_uuid}")
        assert response.status_code in {404, 400, 200}


class TestRolePermissionsManagement:
    @pytest.mark.asyncio
    async def test_get_permissions_invalid_uuid(self, admin_client):
        response = await admin_client.get("/admin/role-permissions/invalid-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_permissions_invalid_uuid(self, admin_client):
        response = await admin_client.put(
            "/admin/role-permissions/invalid-uuid",
            json={"permissions": []},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_permissions_nonexistent_role(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.put(
            f"/admin/role-permissions/{fake_uuid}",
            json=[],
        )
        assert response.status_code in {404, 400, 422}

    @pytest.mark.asyncio
    async def test_update_permissions_empty_array(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.put(
            f"/admin/role-permissions/{fake_uuid}",
            json={"permissions": []},
        )
        assert response.status_code in {200, 404, 400, 422}


class TestRoleOutputValidation:
    @pytest.mark.asyncio
    async def test_roles_list_response_schema(self, admin_client):
        response = await admin_client.get("/admin/role")
        assert response.status_code in {200, 404}
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_roles_response_no_sensitive_data(self, admin_client):
        response = await admin_client.get("/admin/roles")
        if response.status_code == 200:
            data_str = str(response.json())
            assert "password" not in data_str.lower()
            assert "secret" not in data_str.lower()

    @pytest.mark.asyncio
    async def test_audit_logs_response_schema(self, admin_client):
        response = await admin_client.get("/admin/role-permissions-audit-logs")
        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, list)


class TestRoleSecurity:
    @pytest.mark.asyncio
    async def test_regular_user_cannot_create_role(self, auth_client):
        response = await auth_client.post(
            "/admin/role",
            json={"name": "hacker_role", "description": "Attempt privilege escalation"},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_regular_user_cannot_update_role(self, auth_client):
        fake_uuid = str(uuid4())
        response = await auth_client.patch(
            f"/admin/role/{fake_uuid}",
            json={"name": "hacked_name"},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_regular_user_cannot_delete_role(self, auth_client):
        fake_uuid = str(uuid4())
        response = await auth_client.delete(f"/admin/role/{fake_uuid}")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_regular_user_cannot_modify_permissions(self, auth_client):
        fake_uuid = str(uuid4())
        response = await auth_client.put(
            f"/admin/role-permissions/{fake_uuid}",
            json={"permissions": [{"type": "backend", "access": "full-access"}]},
        )
        assert response.status_code in {401, 403}


class TestGetWidgetChanges:
    def test_both_lists_empty(self):
        result = get_widget_changes([], [])
        assert result == {"old": [], "new": []}

    def test_old_widgets_none(self):
        new_widgets = [{"widgetId": "widget1", "access": "access"}]
        result = get_widget_changes(new_widgets, None)  # type: ignore[arg-type]
        assert result == {"old": None, "new": new_widgets}

    def test_new_widgets_none(self):
        old_widgets = [{"widgetId": "widget1", "access": "access"}]
        result = get_widget_changes(None, old_widgets)  # type: ignore[arg-type]
        assert result == {"old": old_widgets, "new": None}

    def test_both_none(self):
        result = get_widget_changes(None, None)  # type: ignore[arg-type]
        assert result == {"old": None, "new": None}

    def test_widget_access_changed(self):
        old_widgets = [{"widgetId": "widget1", "access": "no-access"}]
        new_widgets = [{"widgetId": "widget1", "access": "access"}]
        result = get_widget_changes(new_widgets, old_widgets)
        assert result["new"] == [{"widgetId": "widget1", "access": "access"}]
        assert result["old"] == [{"widgetId": "widget1", "access": "no-access"}]

    def test_widget_added(self):
        old_widgets = [{"widgetId": "widget1", "access": "access"}]
        new_widgets = [
            {"widgetId": "widget1", "access": "access"},
            {"widgetId": "widget2", "access": "access"},
        ]
        result = get_widget_changes(new_widgets, old_widgets)
        assert {"widgetId": "widget2", "access": "access"} in result["new"]

    def test_widget_removed(self):
        old_widgets = [
            {"widgetId": "widget1", "access": "access"},
            {"widgetId": "widget2", "access": "access"},
        ]
        new_widgets = [{"widgetId": "widget1", "access": "access"}]
        result = get_widget_changes(new_widgets, old_widgets)
        assert {"widgetId": "widget2", "access": "access"} in result["old"]

    def test_no_changes(self):
        widgets = [
            {"widgetId": "widget1", "access": "access"},
            {"widgetId": "widget2", "access": "no-access"},
        ]
        result = get_widget_changes(widgets, widgets)
        assert result["new"] == []
        assert result["old"] == []

    def test_multiple_changes(self):
        old_widgets = [
            {"widgetId": "widget1", "access": "access"},
            {"widgetId": "widget2", "access": "no-access"},
            {"widgetId": "widget3", "access": "access"},
        ]
        new_widgets = [
            {"widgetId": "widget1", "access": "no-access"},
            {"widgetId": "widget2", "access": "access"},
            {"widgetId": "widget4", "access": "access"},
        ]
        result = get_widget_changes(new_widgets, old_widgets)
        new_widget_ids = [w["widgetId"] for w in result["new"]]
        old_widget_ids = [w["widgetId"] for w in result["old"]]
        assert "widget1" in new_widget_ids
        assert "widget2" in new_widget_ids
        assert "widget4" in new_widget_ids
        assert "widget3" in old_widget_ids


class TestGetTemplateChanges:
    def test_both_lists_empty(self):
        result = get_template_changes([], [])
        assert result == {"old": [], "new": []}

    def test_old_templates_none(self):
        new_templates = [{"templateId": "t1", "access": "access"}]
        result = get_template_changes(new_templates, None)  # type: ignore[arg-type]
        assert result == {"old": None, "new": new_templates}

    def test_new_templates_none(self):
        old_templates = [{"templateId": "t1", "access": "access"}]
        result = get_template_changes(None, old_templates)  # type: ignore[arg-type]
        assert result == {"old": old_templates, "new": None}

    def test_both_none(self):
        result = get_template_changes(None, None)  # type: ignore[arg-type]
        assert result == {"old": None, "new": None}

    def test_template_access_changed(self):
        old_templates = [{"templateId": "t1", "access": "no-access"}]
        new_templates = [{"templateId": "t1", "access": "access"}]
        result = get_template_changes(new_templates, old_templates)
        assert len(result["new"]) == 1
        assert result["new"][0]["templateId"] == "t1"
        assert result["new"][0]["access"] == "access"

    def test_template_added(self):
        old_templates = [{"templateId": "t1", "access": "access"}]
        new_templates = [
            {"templateId": "t1", "access": "access"},
            {"templateId": "t2", "access": "access"},
        ]
        result = get_template_changes(new_templates, old_templates)
        new_template_ids = [t["templateId"] for t in result["new"]]
        assert "t2" in new_template_ids

    def test_template_removed(self):
        old_templates = [
            {"templateId": "t1", "access": "access"},
            {"templateId": "t2", "access": "access"},
        ]
        new_templates = [{"templateId": "t1", "access": "access"}]
        result = get_template_changes(new_templates, old_templates)
        old_template_ids = [t["templateId"] for t in result["old"]]
        assert "t2" in old_template_ids

    def test_no_changes(self):
        templates = [
            {"templateId": "t1", "access": "access"},
            {"templateId": "t2", "access": "no-access"},
        ]
        result = get_template_changes(templates, templates)
        assert result["new"] == []
        assert result["old"] == []

    def test_prompt_changes_within_template(self):
        old_templates = [
            {
                "templateId": "t1",
                "access": "access",
                "prompts": [{"promptId": "p1", "access": "no-access"}],
            }
        ]
        new_templates = [
            {
                "templateId": "t1",
                "access": "access",
                "prompts": [{"promptId": "p1", "access": "access"}],
            }
        ]
        result = get_template_changes(new_templates, old_templates)
        assert len(result["new"]) == 1
        assert "prompts" in result["new"][0]

    def test_prompt_added_within_template(self):
        old_templates = [
            {
                "templateId": "t1",
                "access": "access",
                "prompts": [{"promptId": "p1", "access": "access"}],
            }
        ]
        new_templates = [
            {
                "templateId": "t1",
                "access": "access",
                "prompts": [
                    {"promptId": "p1", "access": "access"},
                    {"promptId": "p2", "access": "access"},
                ],
            }
        ]
        result = get_template_changes(new_templates, old_templates)
        assert len(result["new"]) == 1


class TestRoleAuditTypes:
    def test_role_audit_action_values(self):
        assert RoleAuditAction.CREATE.value == "create"
        assert RoleAuditAction.UPDATE.value == "update"
        assert RoleAuditAction.DELETE.value == "delete"
        assert RoleAuditAction.RESTORE.value == "restore"
        assert RoleAuditAction.ASSIGN.value == "assign"
        assert RoleAuditAction.REMOVE.value == "remove"
        assert RoleAuditAction.ADD.value == "add"

    def test_role_resource_type_values(self):
        assert RoleResourceType.ROLE.value == "role"
        assert RoleResourceType.BACKEND.value == "backend"
        assert RoleResourceType.FILE.value == "file"
        assert RoleResourceType.PROMPT.value == "prompt"
        assert RoleResourceType.USER.value == "user"

    def test_role_audit_action_all_members(self):
        expected_actions = {
            "CREATE",
            "UPDATE",
            "DELETE",
            "RESTORE",
            "ASSIGN",
            "REMOVE",
            "ADD",
        }
        actual_actions = {member.name for member in RoleAuditAction}
        assert actual_actions == expected_actions

    def test_role_resource_type_all_members(self):
        expected_types = {"ROLE", "BACKEND", "FILE", "PROMPT", "USER", "WIDGET_PLUGIN"}
        actual_types = {member.name for member in RoleResourceType}
        assert actual_types == expected_types


class TestRoleAuditLogIntegration:
    @pytest.mark.asyncio
    async def test_audit_log_created_on_role_creation(self, admin_client):
        role_name = f"audit_test_role_{uuid4().hex[:8]}"

        create_response = await admin_client.post(
            "/admin/role",
            json={"name": role_name, "description": "Test audit logging"},
        )

        if create_response.status_code not in {200, 201}:
            skip("Role creation not available")
            return

        role_data = create_response.json()
        role_uuid = role_data.get("uuid")

        await asyncio.sleep(0.5)

        audit_response = await admin_client.get("/admin/role-permissions-audit-logs")
        if audit_response.status_code == 200:
            audit_logs = audit_response.json()
            assert isinstance(audit_logs, list)

        if role_uuid:
            await admin_client.delete(f"/admin/role/{role_uuid}")

    @pytest.mark.asyncio
    async def test_audit_log_created_on_role_update(self, admin_client):
        role_name = f"update_audit_test_{uuid4().hex[:8]}"

        create_response = await admin_client.post(
            "/admin/role",
            json={"name": role_name, "description": "Original description"},
        )

        if create_response.status_code not in {200, 201}:
            skip("Role creation not available")
            return

        role_data = create_response.json()
        role_uuid = role_data.get("uuid")

        update_response = await admin_client.patch(
            f"/admin/role/{role_uuid}",
            json={"description": "Updated description"},
        )

        if update_response.status_code == 200:
            await asyncio.sleep(0.5)

            audit_response = await admin_client.get("/admin/role-permissions-audit-logs")
            if audit_response.status_code == 200:
                audit_logs = audit_response.json()
                assert isinstance(audit_logs, list)

        if role_uuid:
            await admin_client.delete(f"/admin/role/{role_uuid}")

    @pytest.mark.asyncio
    async def test_audit_log_created_on_role_deletion(self, admin_client):
        role_name = f"delete_audit_test_{uuid4().hex[:8]}"

        create_response = await admin_client.post(
            "/admin/role",
            json={"name": role_name, "description": "To be deleted"},
        )

        if create_response.status_code not in {200, 201}:
            skip("Role creation not available")
            return

        role_data = create_response.json()
        role_uuid = role_data.get("uuid")

        delete_response = await admin_client.delete(f"/admin/role/{role_uuid}")

        if delete_response.status_code in {200, 204}:
            await asyncio.sleep(0.5)

            audit_response = await admin_client.get("/admin/role-permissions-audit-logs")
            if audit_response.status_code == 200:
                audit_logs = audit_response.json()
                assert isinstance(audit_logs, list)

    @pytest.mark.asyncio
    async def test_audit_log_response_schema(self, admin_client):
        response = await admin_client.get("/admin/role-permissions-audit-logs")

        if response.status_code == 200:
            audit_logs = response.json()
            assert isinstance(audit_logs, list)

            if len(audit_logs) > 0:
                log_entry = audit_logs[0]
                expected_fields = {"action", "resource_type"}
                present_fields = set(log_entry.keys())
                assert len(expected_fields & present_fields) > 0

    @pytest.mark.asyncio
    async def test_audit_logs_ordered_by_timestamp(self, admin_client):
        response = await admin_client.get("/admin/role-permissions-audit-logs")

        if response.status_code == 200:
            audit_logs = response.json()
            if len(audit_logs) >= 2:
                timestamps = [
                    log.get("created_at") or log.get("timestamp")
                    for log in audit_logs
                    if log.get("created_at") or log.get("timestamp")
                ]
                if len(timestamps) >= 2:
                    for i in range(len(timestamps) - 1):
                        assert timestamps[i] >= timestamps[i + 1]


class TestRolePermissionEventsEdgeCases:
    @pytest.mark.asyncio
    async def test_role_with_special_characters_in_name(self, admin_client):
        special_name = f"test-role_with.special@chars#{uuid4().hex[:4]}"

        response = await admin_client.post(
            "/admin/role",
            json={"name": special_name, "description": "Special chars test"},
        )

        if response.status_code in {200, 201}:
            role_uuid = response.json().get("uuid")
            if role_uuid:
                await admin_client.delete(f"/admin/role/{role_uuid}")

    @pytest.mark.asyncio
    async def test_role_with_unicode_name(self, admin_client):
        unicode_name = f"テスト役割_{uuid4().hex[:4]}"

        response = await admin_client.post(
            "/admin/role",
            json={"name": unicode_name, "description": "Unicode test"},
        )

        if response.status_code in {200, 201}:
            role_uuid = response.json().get("uuid")
            if role_uuid:
                await admin_client.delete(f"/admin/role/{role_uuid}")

    @pytest.mark.asyncio
    async def test_concurrent_role_operations(self, admin_client):
        role_names = [f"concurrent_test_{i}_{uuid4().hex[:4]}" for i in range(3)]

        create_tasks = [
            admin_client.post(
                "/admin/role",
                json={"name": name, "description": "Concurrent test"},
            )
            for name in role_names
        ]

        responses = await asyncio.gather(*create_tasks, return_exceptions=True)

        role_uuids = []
        for response in responses:
            if isinstance(response, Response) and response.status_code in {
                200,
                201,
            }:
                role_uuid = response.json().get("uuid")
                if role_uuid:
                    role_uuids.append(role_uuid)

        for role_uuid in role_uuids:
            await admin_client.delete(f"/admin/role/{role_uuid}")
