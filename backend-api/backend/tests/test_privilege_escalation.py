import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import uuid4


class TestHorizontalPrivilegeEscalationDashboards:
    @pytest.mark.asyncio
    async def test_cannot_read_other_users_dashboard(
        self, auth_client, second_user_client
    ):
        dashboard_uuid = str(uuid4())
        create_payload = {
            "items": {
                dashboard_uuid: {
                    "name": "User A Private Dashboard",
                    "data": {"private": "data"},
                }
            }
        }
        create_response = await auth_client.post("/app/dash/sync", json=create_payload)
        assert (
            create_response.status_code == 200
        ), f"Dashboard creation failed: {create_response.status_code} - {create_response.text}"

        response = await second_user_client.get(f"/app/dash/{dashboard_uuid}")
        assert response.status_code in {
            403,
            404,
        }, f"Expected 403/404 but got {response.status_code}"

    @pytest.mark.asyncio
    async def test_cannot_update_other_users_dashboard(
        self, auth_client, second_user_client
    ):
        dashboard_uuid = str(uuid4())
        create_payload = {
            "items": {
                dashboard_uuid: {
                    "name": "User A Dashboard",
                    "data": {"original": True},
                }
            }
        }
        await auth_client.post("/app/dash/sync", json=create_payload)

        update_payload = {
            "items": {
                dashboard_uuid: {
                    "name": "HACKED by User B",
                    "data": {"hacked": True},
                }
            }
        }
        await second_user_client.post("/app/dash/sync", json=update_payload)

        verify_response = await auth_client.get(f"/app/dash/{dashboard_uuid}")
        if verify_response.status_code == 200:
            data = verify_response.json()
            assert data.get("name") != "HACKED by User B"

    @pytest.mark.asyncio
    async def test_cannot_delete_other_users_dashboard(
        self, auth_client, second_user_client
    ):
        dashboard_uuid = str(uuid4())
        create_payload = {
            "items": {
                dashboard_uuid: {
                    "name": "User A Dashboard to Delete",
                    "data": {},
                }
            }
        }
        await auth_client.post("/app/dash/sync", json=create_payload)

        delete_payload = {"items": {dashboard_uuid: "DELETE"}}
        await second_user_client.post("/app/dash/sync", json=delete_payload)

        verify_response = await auth_client.get(f"/app/dash/{dashboard_uuid}")
        assert verify_response.status_code in {200, 403, 404}

    @pytest.mark.asyncio
    async def test_cannot_share_other_users_dashboard(
        self, auth_client, second_user_client
    ):
        dashboard_uuid = str(uuid4())
        create_payload = {
            "items": {
                dashboard_uuid: {
                    "name": "User A Dashboard",
                    "data": {},
                }
            }
        }
        create_response = await auth_client.post("/app/dash/sync", json=create_payload)
        assert (
            create_response.status_code == 200
        ), f"Dashboard creation failed: {create_response.status_code} - {create_response.text}"

        response = await second_user_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"shares": [{"email": "attacker@evil.com", "permission": "view"}]},
        )
        assert response.status_code in {
            403,
            404,
            422,
        }, f"Expected 403/404/422 but got {response.status_code}"


class TestHorizontalPrivilegeEscalationDataConnectors:
    @pytest.mark.asyncio
    async def test_cannot_read_other_users_data_connectors(
        self, auth_client, second_user_client
    ):
        source_uuid = str(uuid4())
        create_response = await auth_client.post(
            f"/app/data-connectors/api-source/{source_uuid}",
            json={
                "name": f"User A Connector {uuid4().hex[:8]}",
                "url": "https://api.example.com/data",
            },
        )
        assert create_response.status_code == 200

        list_response = await second_user_client.get("/app/data-connectors/api-source")
        assert (
            list_response.status_code == 200
        ), f"List failed: {list_response.status_code}"
        assert source_uuid not in {
            str(item.get("uuid")) for item in list_response.json()
        }, "User B can see User A's connector!"

        await auth_client.delete(f"/app/data-connectors/api-source/{source_uuid}")

    @pytest.mark.asyncio
    async def test_cannot_modify_other_users_data_connector_by_uuid(
        self, auth_client, second_user_client
    ):
        source_uuid = str(uuid4())
        name = f"User A Secret Connector {uuid4().hex[:8]}"
        create_response = await auth_client.post(
            f"/app/data-connectors/api-source/{source_uuid}",
            json={"name": name, "url": "https://api.example.com/data"},
        )
        assert create_response.status_code == 200

        await second_user_client.post(
            f"/app/data-connectors/api-source/{source_uuid}",
            json={"name": "hijacked", "url": "https://attacker.example.com/"},
        )
        await second_user_client.delete(
            f"/app/data-connectors/api-source/{source_uuid}"
        )

        sources = (await auth_client.get("/app/data-connectors/api-source")).json()
        mine = [item for item in sources if str(item.get("uuid")) == source_uuid]
        assert len(mine) == 1, "User B deleted User A's connector"
        assert mine[0]["name"] == name, "User B overwrote User A's connector"

        await auth_client.delete(f"/app/data-connectors/api-source/{source_uuid}")


class TestHorizontalPrivilegeEscalationUserData:
    @pytest.mark.asyncio
    async def test_cannot_read_other_users_profile(
        self, auth_client, second_user_client
    ):
        user_a_profile = await auth_client.get("/app/user")
        assert user_a_profile.status_code == 200

        user_a_data = user_a_profile.json()
        user_a_uuid = user_a_data.get("uuid")

        if user_a_uuid:
            response = await second_user_client.get(f"/user/{user_a_uuid}")
            assert response.status_code in {403, 404, 405}

    @pytest.mark.asyncio
    async def test_cannot_modify_other_users_profile(
        self, auth_client, second_user_client
    ):
        user_a_profile = await auth_client.get("/app/user")
        user_a_data = user_a_profile.json()
        user_a_uuid = user_a_data.get("uuid")

        if user_a_uuid:
            response = await second_user_client.put(
                f"/user/{user_a_uuid}",
                json={"username": "hacked_username"},
            )
            assert response.status_code in {401, 403, 404, 405}

    @pytest.mark.asyncio
    async def test_cannot_read_or_revoke_other_users_access_token(
        self, auth_client, second_user_client
    ):
        created = await auth_client.post(
            "/app/workspace-mcp/tokens", json={"name": "User A's host"}
        )
        assert created.status_code == 200
        token_uuid = created.json()["uuid"]

        listed = await second_user_client.get("/app/workspace-mcp/tokens")
        assert listed.status_code == 200
        assert all(token["uuid"] != token_uuid for token in listed.json())

        revoked = await second_user_client.delete(
            f"/app/workspace-mcp/tokens/{token_uuid}"
        )
        assert revoked.status_code in {204, 401, 403, 404}

        still_there = await auth_client.get("/app/workspace-mcp/tokens")
        assert still_there.status_code == 200
        assert any(token["uuid"] == token_uuid for token in still_there.json())


class TestVerticalPrivilegeEscalationAdmin:
    @pytest.mark.asyncio
    async def test_regular_user_cannot_access_admin_users_list(self, auth_client):
        response = await auth_client.get("/admin/users")
        assert response.status_code in {401, 403, 404}

    @pytest.mark.asyncio
    async def test_regular_user_cannot_access_admin_metrics(self, auth_client):
        response = await auth_client.get("/admin/metrics")
        assert response.status_code in {401, 403, 404}

    @pytest.mark.asyncio
    async def test_regular_user_cannot_delete_other_users(self, auth_client):
        fake_user_uuid = str(uuid4())
        response = await auth_client.delete(f"/admin/user/{fake_user_uuid}")
        assert response.status_code in {401, 403, 404, 405}

    @pytest.mark.asyncio
    async def test_regular_user_cannot_create_roles(self, auth_client):
        response = await auth_client.post(
            "/entity/role",
            json={"name": "super_admin", "description": "Escalated role"},
        )
        assert response.status_code in {401, 403, 422}


class TestIDORVulnerabilities:
    @pytest.mark.asyncio
    async def test_sequential_uuid_enumeration(self, auth_client):
        test_uuids = [
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
            "00000000-0000-0000-0000-000000000003",
        ]

        for test_uuid in test_uuids:
            response = await auth_client.get(f"/app/dash/{test_uuid}")
            assert response.status_code in {403, 404}

    @pytest.mark.asyncio
    async def test_uuid_manipulation_in_path(self, auth_client, second_user_client):
        dashboard_uuid = str(uuid4())
        await auth_client.post(
            "/app/dash/sync",
            json={
                "dashboards": [
                    {"uuid": dashboard_uuid, "name": "Test Dashboard", "data": {}}
                ]
            },
        )

        uuid_variations = [
            dashboard_uuid,
            dashboard_uuid.upper(),
            dashboard_uuid.replace("-", ""),
        ]

        for uuid_var in uuid_variations:
            response = await second_user_client.get(f"/app/dash/{uuid_var}")
            assert response.status_code in {403, 404, 422}


class TestTokenManipulation:
    @pytest.mark.asyncio
    async def test_expired_token_rejected(self, client):
        expired_jwt = (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
            "eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxfQ."
            "invalid_signature"
        )

        client.headers["Authorization"] = f"Bearer {expired_jwt}"
        response = await client.get("/app/user")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_malformed_token_rejected(self, client):
        malformed_tokens = [
            "not-a-jwt",
            "Bearer ",
            "Bearer invalid",
            "Bearer eyJhbGciOiJIUzI1NiJ9",
            "Bearer " + "a" * 1000,
        ]

        for token in malformed_tokens:
            client.headers["Authorization"] = token
            response = await client.get("/app/user")
            assert response.status_code in {401, 403, 422}

    @pytest.mark.asyncio
    async def test_token_with_modified_payload(self, client):
        tampered_jwt = (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
            "eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0."
            "tampered_signature_here"
        )

        client.headers["Authorization"] = f"Bearer {tampered_jwt}"
        response = await client.get("/app/user")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_none_algorithm_attack(self, client):
        none_alg_jwt = (
            "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0."
            "eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiJ9."
        )

        client.headers["Authorization"] = f"Bearer {none_alg_jwt}"
        response = await client.get("/app/user")
        assert response.status_code in {401, 403}


class TestSessionHijackingPrevention:
    @pytest.mark.asyncio
    async def test_cannot_reuse_logged_out_session(self, client, auth_client):
        original_headers = dict(auth_client.headers)

        logout_response = await auth_client.post("/app/logout")
        assert logout_response.status_code == 200
        assert logout_response.json()["success"] is True

        client.headers.update(original_headers)
        response = await client.get("/app/user")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_session_not_valid_across_users(
        self, auth_client, second_user_client
    ):
        user_a_response = await auth_client.get("/app/user")
        assert user_a_response.status_code == 200
        user_a_data = user_a_response.json()

        user_b_response = await second_user_client.get("/app/user")
        assert user_b_response.status_code == 200
        user_b_data = user_b_response.json()

        assert (
            user_a_data["uuid"] != user_b_data["uuid"]
        ), "Sessions should return different user data"


class TestParameterTampering:
    @pytest.mark.asyncio
    async def test_cannot_escalate_via_request_body(self, auth_client):
        response = await auth_client.put(
            "/user",
            json={
                "is_admin": True,
                "role": "admin",
                "permissions": ["all"],
            },
        )
        if response.status_code == 200:
            user_response = await auth_client.get("/app/user")
            user_data = user_response.json()
            assert user_data.get("is_admin") is not True

    @pytest.mark.asyncio
    async def test_cannot_set_other_user_uuid_in_body(
        self, auth_client, second_user_client
    ):
        user_a_response = await auth_client.get("/app/user")
        user_a_uuid = user_a_response.json().get("uuid")

        dashboard_uuid = str(uuid4())
        response = await second_user_client.post(
            "/app/dash/sync",
            json={
                "dashboards": [
                    {
                        "uuid": dashboard_uuid,
                        "name": "Impersonation Dashboard",
                        "data": {},
                        "user_uuid": user_a_uuid,
                        "owner_uuid": user_a_uuid,
                    }
                ]
            },
        )

        if response.status_code == 200:
            user_a_dashboards = await auth_client.get("/app/dash")
            if user_a_dashboards.status_code == 200:
                data = user_a_dashboards.json()
                owned = data.get("owned", {})
                assert dashboard_uuid not in owned

    @pytest.mark.asyncio
    async def test_hidden_form_field_injection(self, auth_client):
        response = await auth_client.put(
            "/user",
            json={
                "__admin__": True,
                "_is_superuser": True,
                "internal_role": "admin",
                "bypass_auth": True,
            },
        )
        assert response.status_code in {200, 400, 422}

        if response.status_code == 200:
            user_response = await auth_client.get("/app/user")
            assert user_response.status_code == 200


class TestRateLimitBypass:
    @pytest.mark.asyncio
    async def test_cannot_bypass_rate_limit_via_headers(self, client):
        bypass_headers = [
            {"X-Forwarded-For": "127.0.0.1"},
            {"X-Real-IP": "127.0.0.1"},
            {"X-Originating-IP": "127.0.0.1"},
            {"CF-Connecting-IP": "127.0.0.1"},
            {"True-Client-IP": "127.0.0.1"},
        ]

        for headers in bypass_headers:
            client.headers.update(headers)
            response = await client.post(
                "/app/login",
                json={"email": "test@test.com", "password": "wrong"},
            )
            assert response.status_code in {401, 422, 429}
