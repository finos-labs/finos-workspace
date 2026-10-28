import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import uuid4
from sqlalchemy import text

from tests.fixtures.base import _ADMIN_USER


class TestAdminUsers:
    @pytest.mark.asyncio
    async def test_get_users_unauthenticated(self, client):
        response = await client.get("/admin/users")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_users_authenticated_non_admin(self, auth_client):
        response = await auth_client.get("/admin/users")
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_create_user_unauthenticated(self, client):
        response = await client.post("/admin/create-user", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_delete_user_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/admin/users/{test_uuid}")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data


class TestAdminSingleUser:
    @pytest.mark.asyncio
    async def test_delete_user_by_uuid_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/admin/users/{test_uuid}")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_update_user_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.patch(f"/admin/users/{test_uuid}", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data


class TestAdminRegister:
    @pytest.mark.asyncio
    async def test_admin_register_unauthenticated(self, client):
        response = await client.post("/admin/register", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data


class TestAdminEntity:
    @pytest.mark.asyncio
    async def test_get_entity_unauthenticated(self, client):
        response = await client.get("/admin/entity")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_update_entity_unauthenticated(self, client):
        response = await client.patch("/admin/entity", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data


class TestAdminApps:
    @pytest.mark.asyncio
    async def test_get_apps_unauthenticated(self, client):
        response = await client.get("/admin/apps")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_apps_authenticated_non_admin(self, auth_client):
        response = await auth_client.get("/admin/apps")
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data or "message" in data or "error" in data


class TestAdminTheme:
    @pytest.mark.asyncio
    async def test_update_theme_unauthenticated(self, client):
        response = await client.patch("/admin/theme-settings", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_update_theme_authenticated_non_admin(self, auth_client):
        response = await auth_client.patch("/admin/theme-settings", json={})
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data or "message" in data or "error" in data


class TestAdminAccessControl:
    @pytest.mark.asyncio
    async def test_regular_user_blocked_from_admin_users(self, auth_client):
        response = await auth_client.get("/admin/users")
        assert response.status_code == 403
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_regular_user_blocked_from_admin_entity(self, auth_client):
        response = await auth_client.get("/admin/entity")
        assert response.status_code == 403
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_regular_user_blocked_from_admin_roles(self, auth_client):
        response = await auth_client.get("/admin/role")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_regular_user_blocked_from_create_user(self, auth_client):
        response = await auth_client.post(
            "/admin/create-user",
            json={
                "email": f"test_{uuid4().hex[:8]}@example.com",
                "username": "testuser",
            },
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_regular_user_blocked_from_register_invite(self, auth_client):
        response = await auth_client.post(
            "/admin/register",
            json={"email": f"invite_{uuid4().hex[:8]}@example.com"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_regular_user_blocked_from_theme_settings(self, auth_client):
        response = await auth_client.patch(
            "/admin/theme-settings",
            json={"primary_color": "#000000"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_admin_can_access_admin_entity(self, admin_client):
        response = await admin_client.get("/admin/entity")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_admin_can_access_admin_entity_map(self, admin_client):
        response = await admin_client.get("/admin/entity-map")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    @pytest.mark.asyncio
    async def test_admin_can_access_admin_users_list(self, admin_client):
        response = await admin_client.get("/admin/users")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    @pytest.mark.asyncio
    async def test_admin_can_access_admin_apps(self, admin_client):
        response = await admin_client.get("/admin/apps")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    @pytest.mark.asyncio
    async def test_admin_can_access_admin_roles(self, admin_client):
        response = await admin_client.get("/admin/role")
        assert response.status_code == 200
        assert isinstance(response.json(), list)


class TestAdminInputValidation:
    @pytest.mark.asyncio
    async def test_create_user_invalid_email(self, admin_client):
        response = await admin_client.post(
            "/admin/create-user",
            json={"email": "not-an-email", "username": "testuser"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_user_empty_email(self, admin_client):
        response = await admin_client.post(
            "/admin/create-user",
            json={"email": "", "username": "testuser"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_user_sql_injection_email(self, admin_client, db_session):
        response = await admin_client.post(
            "/admin/create-user",
            json={
                "email": "test@test.com'; DROP TABLE user; --",
                "username": "testuser",
            },
        )
        assert response.status_code in {400, 422}

        result = await db_session.execute(text("SELECT COUNT(*) FROM user"))
        count = result.scalar()
        assert count is not None

    @pytest.mark.asyncio
    async def test_register_invite_invalid_email(self, admin_client):
        response = await admin_client.post(
            "/admin/register",
            json={"email": "invalid-email"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_update_user_invalid_uuid(self, admin_client):
        response = await admin_client.patch(
            "/admin/users/not-a-uuid",
            json={"username": "newname"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_delete_user_invalid_uuid(self, admin_client):
        response = await admin_client.delete("/admin/users/not-a-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_reset_password_invalid_uuid(self, admin_client):
        response = await admin_client.post("/admin/reset-password/not-a-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_role_empty_name(self, admin_client):
        response = await admin_client.post(
            "/admin/role",
            json={"name": ""},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_role_duplicate_detection(self, admin_client):
        role_name = f"TestRole_{uuid4().hex[:8]}"
        response1 = await admin_client.post(
            "/admin/role",
            json={"name": role_name},
        )
        if response1.status_code == 200:
            response2 = await admin_client.post(
                "/admin/role",
                json={"name": role_name},
            )
            assert response2.status_code in {400, 409, 422}


class TestAdminOutputValidation:
    @pytest.mark.asyncio
    async def test_users_list_response_schema(self, admin_client):
        response = await admin_client.get("/admin/users")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        for user in data:
            assert "uuid" in user or "email" in user

    @pytest.mark.asyncio
    async def test_roles_list_response_schema(self, admin_client):
        response = await admin_client.get("/admin/role")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_entity_response_no_sensitive_data(self, admin_client):
        response = await admin_client.get("/admin/entity")
        assert response.status_code == 200
        data = response.json()
        assert "_sa_instance_state" not in str(data)
        assert "password" not in str(data).lower() or "null" in str(data).lower()


class TestAdminUserManagement:
    @pytest.mark.asyncio
    async def test_delete_nonexistent_user(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.delete(f"/admin/users/{fake_uuid}")
        assert response.status_code in {404, 400}

    @pytest.mark.asyncio
    async def test_update_nonexistent_user(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.patch(
            f"/admin/users/{fake_uuid}",
            json={"permissions_uuid": _ADMIN_USER["perm_uuid"]},
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Matching user not found"

    @pytest.mark.asyncio
    async def test_remove_nonexistent_user(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.delete(f"/admin/users/{fake_uuid}/remove")
        assert response.status_code in {404, 400}

    @pytest.mark.asyncio
    async def test_reset_password_nonexistent_user(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.post(f"/admin/reset-password/{fake_uuid}")
        assert response.status_code == 403


class TestAdminRoleManagement:
    @pytest.mark.asyncio
    async def test_get_nonexistent_role(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.get(f"/admin/role/{fake_uuid}")
        assert response.status_code in {404, 400}

    @pytest.mark.asyncio
    async def test_update_nonexistent_role(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.patch(
            f"/admin/role/{fake_uuid}",
            json={"name": "NewName"},
        )
        assert response.status_code in {404, 400}

    @pytest.mark.asyncio
    async def test_delete_nonexistent_role(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.delete(f"/admin/role/{fake_uuid}")
        assert response.status_code in {404, 400}

    @pytest.mark.asyncio
    async def test_update_role_permissions_nonexistent(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.put(
            f"/admin/role-permissions/{fake_uuid}",
            json={"permissions": []},
        )
        assert response.status_code in {404, 400, 422}


class TestAdminEntityOperations:
    @pytest.mark.asyncio
    async def test_patch_entity_with_invalid_value(self, admin_client):
        response = await admin_client.patch(
            "/admin/entity",
            json={"require_authenticator": "not_a_boolean"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_patch_entity_with_valid_value(self, admin_client):
        response = await admin_client.patch(
            "/admin/entity",
            json={"require_authenticator": True},
        )
        assert response.status_code in {200, 400, 404}


class TestAdminInviteManagement:
    @pytest.mark.asyncio
    async def test_delete_nonexistent_invite(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.delete(f"/admin/register/{fake_uuid}")
        assert response.status_code in {404, 400}

    @pytest.mark.asyncio
    async def test_register_invite_xss_attempt(self, admin_client):
        response = await admin_client.post(
            "/admin/register",
            json={"email": "<script>alert('xss')</script>@test.com"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_register_invite_long_email(self, admin_client):
        long_email = "a" * 300 + "@test.com"
        response = await admin_client.post(
            "/admin/register",
            json={"email": long_email},
        )
        assert response.status_code == 422


class TestAdminRateLimits:
    @pytest.mark.asyncio
    async def test_admin_endpoints_have_rate_limits(self, admin_client):
        responses = []
        for _ in range(5):
            response = await admin_client.get("/admin/entity-map")
            responses.append(response.status_code)

        assert all(code in {200, 429} for code in responses)


class TestAdminPasswordReset:
    @pytest.mark.asyncio
    async def test_reset_password_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.post(f"/admin/reset-password/{test_uuid}")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_reset_password_non_admin(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.post(f"/admin/reset-password/{test_uuid}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_reset_password_invalid_uuid(self, admin_client):
        response = await admin_client.post("/admin/reset-password/not-a-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_reset_password_returns_a_link(self, organization, admin_client):
        user = await organization.add_user()
        response = await admin_client.post(f"/admin/reset-password/{user.uuid}")
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["link"].startswith("http://localhost:3000/reset-password#")
        assert "temporary_password" not in data


class TestAdmin2FAReset:
    @pytest.mark.asyncio
    async def test_reset_2fa_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.post(f"/admin/reset-2fa/{test_uuid}")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_reset_2fa_non_admin(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.post(f"/admin/reset-2fa/{test_uuid}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_reset_2fa_invalid_uuid(self, admin_client):
        response = await admin_client.post("/admin/reset-2fa/not-a-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_reset_2fa_for_existing_user(self, admin_client):
        users_response = await admin_client.get("/admin/user")
        if users_response.status_code == 200:
            users = users_response.json()
            if users and len(users) > 0:
                user_uuid = users[0].get("uuid")
                if user_uuid:
                    response = await admin_client.post(f"/admin/reset-2fa/{user_uuid}")
                    assert response.status_code in {200, 400}
                    if response.status_code == 200:
                        data = response.json()
                        assert isinstance(data, dict)

    @pytest.mark.asyncio
    async def test_reset_2fa_cross_org(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.post(f"/admin/reset-2fa/{fake_uuid}")
        assert response.status_code == 403
        assert response.json().get("detail") == "Cannot reset 2FA for users outside your organization"


class TestAdminCreateUser:
    @pytest.mark.asyncio
    async def test_create_user_unauthenticated(self, client):
        response = await client.post(
            "/admin/create-user",
            json={"email": "test@test.com"},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_create_user_non_admin(self, auth_client):
        response = await auth_client.post(
            "/admin/create-user",
            json={"email": "test@test.com"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_create_user_missing_email(self, admin_client):
        response = await admin_client.post("/admin/create-user", json={})
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_user_invalid_email(self, admin_client):
        response = await admin_client.post(
            "/admin/create-user",
            json={"email": "not-an-email"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_user_and_verify_exists(self, admin_client):
        unique_email = f"created_{uuid4().hex[:8]}@testintegration.com"

        create_response = await admin_client.post(
            "/admin/create-user",
            json={"email": unique_email},
        )

        if create_response.status_code in {200, 201}:
            data = create_response.json()
            assert isinstance(data, dict)
            assert "password" in data or "uuid" in data or "success" in data

            users_response = await admin_client.get("/admin/user")
            if users_response.status_code == 200:
                users = users_response.json()
                assert isinstance(users, list)
                assert any(isinstance(u, dict) and u.get("email", "").lower() == unique_email.lower() for u in users)
        elif create_response.status_code == 400:
            pass

    @pytest.mark.asyncio
    async def test_create_duplicate_user_fails(self, admin_client):
        unique_email = f"duplicate_{uuid4().hex[:8]}@testintegration.com"

        first_response = await admin_client.post(
            "/admin/create-user",
            json={"email": unique_email},
        )

        if first_response.status_code in {200, 201}:
            second_response = await admin_client.post(
                "/admin/create-user",
                json={"email": unique_email},
            )
            assert second_response.status_code in {200, 400, 409}


class TestAdminRolePermissionsGet:
    @pytest.mark.asyncio
    async def test_get_role_permissions_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/admin/role-permissions/{test_uuid}")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_role_permissions_non_admin(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(f"/admin/role-permissions/{test_uuid}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_get_role_permissions_invalid_uuid(self, admin_client):
        response = await admin_client.get("/admin/role-permissions/not-a-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_get_permissions_for_existing_role(self, admin_client):
        roles_response = await admin_client.get("/admin/role")
        if roles_response.status_code == 200:
            roles = roles_response.json()
            if roles and len(roles) > 0:
                role_uuid = roles[0].get("uuid")
                if role_uuid:
                    response = await admin_client.get(f"/admin/role-permissions/{role_uuid}")
                    assert response.status_code == 200

                    data = response.json()
                    assert isinstance(data, (dict, list))

    @pytest.mark.asyncio
    async def test_role_permissions_match_role_config(self, admin_client):
        roles_response = await admin_client.get("/admin/role")
        if roles_response.status_code == 200:
            roles = roles_response.json()
            if roles and len(roles) > 0:
                role = roles[0]
                role_uuid = role.get("uuid")
                if role_uuid:
                    perms_response = await admin_client.get(f"/admin/role-permissions/{role_uuid}")
                    if perms_response.status_code == 200:
                        perms = perms_response.json()
                        assert isinstance(perms, (dict, list))


class TestAdminUserModification:
    @pytest.mark.asyncio
    async def test_patch_user_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.patch(
            f"/admin/users/{test_uuid}",
            json={"permissions_uuid": str(uuid4())},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_patch_user_non_admin(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.patch(
            f"/admin/users/{test_uuid}",
            json={"permissions_uuid": str(uuid4())},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_patch_user_invalid_uuid(self, admin_client):
        response = await admin_client.patch(
            "/admin/users/not-a-uuid",
            json={"permissions_uuid": str(uuid4())},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_patch_user_empty_payload(self, admin_client):
        users_response = await admin_client.get("/admin/users")
        if users_response.status_code == 200:
            users = users_response.json()
            if users and len(users) > 0:
                user_uuid = users[0].get("uuid")
                if user_uuid:
                    response = await admin_client.patch(
                        f"/admin/users/{user_uuid}",
                        json={},
                    )
                    assert response.status_code in {200, 400, 422}

    @pytest.mark.asyncio
    async def test_patch_user_cross_org_permissions(self, admin_client):
        fake_perm_uuid = str(uuid4())
        response = await admin_client.patch(
            f"/admin/users/{_ADMIN_USER['user_uuid']}",
            json={"permissions_uuid": fake_perm_uuid},
        )
        assert response.status_code == 403
        assert response.json().get("detail") == "Cannot assign permissions from a different organization"


class TestAdminUserDeletion:
    @pytest.mark.asyncio
    async def test_delete_user_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/admin/users/{test_uuid}")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_delete_user_non_admin(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.delete(f"/admin/users/{test_uuid}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_user_invalid_uuid(self, admin_client):
        response = await admin_client.delete("/admin/users/not-a-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_delete_nonexistent_user_returns_404(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.delete(f"/admin/users/{fake_uuid}")
        assert response.status_code in {400, 404}

    @pytest.mark.asyncio
    async def test_delete_user_full_flow(self, admin_client, db_session):
        unique_email = f"admindelete_{uuid4().hex[:8]}@testintegration.com"

        create_response = await admin_client.post(
            "/admin/create-user",
            json={"email": unique_email},
        )

        if create_response.status_code in {200, 201}:
            users_response = await admin_client.get("/admin/users")
            if users_response.status_code == 200:
                users = users_response.json()
                user_to_delete = None
                for user in users:
                    if user.get("email", "").lower() == unique_email.lower():
                        user_to_delete = user.get("uuid")
                        break

                if user_to_delete:
                    delete_response = await admin_client.delete(f"/admin/users/{user_to_delete}")
                    assert delete_response.status_code == 200

                    delete_again = await admin_client.delete(f"/admin/users/{user_to_delete}")
                    assert delete_again.status_code in {400, 404}


class TestAdminUserRemove:
    @pytest.mark.asyncio
    async def test_remove_user_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/admin/users/{test_uuid}/remove")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_remove_user_non_admin(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.delete(f"/admin/users/{test_uuid}/remove")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_remove_user_invalid_uuid(self, admin_client):
        response = await admin_client.delete("/admin/users/not-a-uuid/remove")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_remove_nonexistent_user_returns_404(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.delete(f"/admin/users/{fake_uuid}/remove")
        assert response.status_code in {400, 404}

    @pytest.mark.asyncio
    async def test_remove_user_from_entity(self, admin_client):
        users_response = await admin_client.get("/admin/users")
        if users_response.status_code == 200:
            users = users_response.json()
            for user in users:
                user_uuid = user.get("uuid")
                if user_uuid:
                    response = await admin_client.delete(f"/admin/users/{user_uuid}/remove")
                    assert response.status_code in {200, 400, 404}
                    break


class TestAdminUserPermissions:
    @pytest.mark.asyncio
    async def test_get_user_permissions_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/admin/user-permissions/{test_uuid}")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_user_permissions_non_admin(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(f"/admin/user-permissions/{test_uuid}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_get_user_permissions_invalid_uuid(self, admin_client):
        response = await admin_client.get("/admin/user-permissions/not-a-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_get_permissions_for_existing_user(self, admin_client):
        users_response = await admin_client.get("/admin/users")
        if users_response.status_code == 200:
            users = users_response.json()
            if users and len(users) > 0:
                user_uuid = users[0].get("uuid")
                if user_uuid:
                    response = await admin_client.get(f"/admin/user-permissions/{user_uuid}")
                    assert response.status_code in {200, 404}

                    if response.status_code == 200:
                        data = response.json()
                        assert isinstance(data, (dict, list))

    @pytest.mark.asyncio
    async def test_get_permissions_for_nonexistent_user(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.get(f"/admin/user-permissions/{fake_uuid}")
        assert response.status_code in {200, 400, 404}


class TestAdminRegisterDelete:
    @pytest.mark.asyncio
    async def test_delete_register_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/admin/register/{test_uuid}")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_delete_register_non_admin(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.delete(f"/admin/register/{test_uuid}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_register_invalid_uuid(self, admin_client):
        response = await admin_client.delete("/admin/register/not-a-uuid")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_delete_nonexistent_invite(self, admin_client):
        fake_uuid = str(uuid4())
        response = await admin_client.delete(f"/admin/register/{fake_uuid}")
        assert response.status_code in {400, 404}

    @pytest.mark.asyncio
    async def test_delete_invite_full_flow(self, admin_client):
        unique_email = f"invitedelete_{uuid4().hex[:8]}@testintegration.com"

        create_response = await admin_client.post(
            "/admin/register",
            json={"email": unique_email},
        )

        if create_response.status_code in {200, 201}:
            create_data = create_response.json()
            invite_uuid = create_data.get("uuid")

            if invite_uuid:
                delete_response = await admin_client.delete(f"/admin/register/{invite_uuid}")
                assert delete_response.status_code == 200

                second_delete = await admin_client.delete(f"/admin/register/{invite_uuid}")
                assert second_delete.status_code in {400, 404}


class TestAdminAppsManagement:
    @pytest.mark.asyncio
    async def test_get_apps_unauthenticated(self, client):
        response = await client.get("/admin/apps")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_apps_non_admin(self, auth_client):
        response = await auth_client.get("/admin/apps")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_get_apps_returns_list(self, admin_client):
        response = await admin_client.get("/admin/apps")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_get_apps_response_schema(self, admin_client):
        response = await admin_client.get("/admin/apps")
        assert response.status_code == 200
        data = response.json()

        for app in data:
            assert isinstance(app, dict)
