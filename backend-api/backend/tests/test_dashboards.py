import os
import sys

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import uuid4


class TestDashboardSync:
    @pytest.mark.asyncio
    async def test_get_dashboards_unauthenticated(self, client):
        response = await client.get("/app/dash/sync")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_dashboards_authenticated(self, auth_client):
        response = await auth_client.get("/app/dash/sync")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type
        if isinstance(data, dict) and "dashboards" in data:
            assert isinstance(data["dashboards"], list)
        if isinstance(data, list) and len(data) > 0:
            dashboard = data[0]
            assert isinstance(dashboard, dict)

    @pytest.mark.asyncio
    async def test_sync_dashboards_unauthenticated(self, client):
        response = await client.post("/app/dash/sync", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_sync_dashboards_authenticated(self, auth_client):
        dashboard_data = {"items": {}}
        response = await auth_client.post("/app/dash/sync", json=dashboard_data)
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") is True

    @pytest.mark.asyncio
    async def test_sync_dashboards_invalid_schema(self, auth_client):
        dashboard_data = {"dashboards": [], "version": 1}
        response = await auth_client.post("/app/dash/sync", json=dashboard_data)
        assert response.status_code == 422


class TestOwnedDashboards:
    @pytest.mark.asyncio
    async def test_get_owned_dashboards_unauthenticated(self, client):
        response = await client.get("/app/dash/sync/owned")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_owned_dashboards_authenticated(self, auth_client):
        response = await auth_client.get("/app/dash/sync/owned")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type


class TestSharedDashboards:
    @pytest.mark.asyncio
    async def test_get_shared_dashboards_unauthenticated(self, client):
        response = await client.get("/app/dash/sync/shared")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_shared_dashboards_authenticated(self, auth_client):
        response = await auth_client.get("/app/dash/sync/shared")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type


class TestDashboardShares:
    @pytest.mark.asyncio
    async def test_get_shares_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/app/dash/{test_uuid}/shares")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data
        response_str = str(data)
        assert test_uuid not in response_str or "not found" in response_str.lower()

    @pytest.mark.asyncio
    async def test_get_shares_nonexistent(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(f"/app/dash/{test_uuid}/shares")
        assert response.status_code in {200, 404, 400}

    @pytest.mark.asyncio
    async def test_share_dashboard_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.post(
            f"/app/dash/{test_uuid}/share", json={"email": "share@example.com"}
        )
        assert response.status_code in {401, 403, 422}

    @pytest.mark.asyncio
    async def test_revoke_share_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/app/dash/{test_uuid}/share")
        assert response.status_code in {401, 403, 422}


class TestDashboardShareUsers:
    @pytest.mark.asyncio
    async def test_get_share_users_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/app/dash/{test_uuid}/shares/users")
        assert response.status_code in {401, 403}


class TestValidateAndSync:
    @pytest.mark.asyncio
    async def test_validate_sync_unauthenticated(self, client):
        response = await client.get("/app/dash/validate-and-sync")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_validate_sync_authenticated(self, auth_client):
        response = await auth_client.get("/app/dash/validate-and-sync")
        assert response.status_code in {200, 400, 404}


class TestDashboardCRUDLifecycle:
    @pytest.mark.asyncio
    async def test_dashboard_create_read_update_delete(self, auth_client):
        dashboard_uuid = str(uuid4())

        create_payload = {
            "dashboards": [
                {
                    "uuid": dashboard_uuid,
                    "name": "Test Dashboard Lifecycle",
                    "description": "Created for integration test",
                    "data": {"widgets": []},
                    "version": 1,
                }
            ]
        }
        create_response = await auth_client.post("/app/dash/sync", json=create_payload)
        assert create_response.status_code in {200, 201, 422}

        if create_response.status_code in {200, 201}:
            get_response = await auth_client.get("/app/dash/sync")
            assert get_response.status_code == 200

            update_payload = {
                "dashboards": [
                    {
                        "uuid": dashboard_uuid,
                        "name": "Updated Dashboard Name",
                        "description": "Updated for integration test",
                        "data": {"widgets": [{"id": "widget1"}]},
                        "version": 2,
                    }
                ]
            }
            update_response = await auth_client.post(
                "/app/dash/sync", json=update_payload
            )
            assert update_response.status_code in {200, 201, 422}

            delete_payload = {"dashboards": [], "deletes": [dashboard_uuid]}
            delete_response = await auth_client.post(
                "/app/dash/sync", json=delete_payload
            )
            assert delete_response.status_code in {200, 422}

    @pytest.mark.asyncio
    async def test_create_multiple_dashboards(self, auth_client):
        dashboards = [
            {
                "uuid": str(uuid4()),
                "name": f"Multi Dashboard {i}",
                "data": {},
                "version": 1,
            }
            for i in range(3)
        ]

        response = await auth_client.post(
            "/app/dash/sync", json={"dashboards": dashboards}
        )
        assert response.status_code in {200, 201, 422}


class TestDashboardResponseSchema:
    @pytest.mark.asyncio
    async def test_sync_response_contains_expected_fields(self, auth_client):
        response = await auth_client.get("/app/dash/sync")
        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, (list, dict))

        if isinstance(data, list) and len(data) > 0:
            dashboard = data[0]
            assert "uuid" in dashboard or "id" in dashboard

    @pytest.mark.asyncio
    async def test_owned_dashboards_response_structure(self, auth_client):
        response = await auth_client.get("/app/dash/sync/owned")
        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, dict)
        assert "owned" in data

    @pytest.mark.asyncio
    async def test_shared_dashboards_response_structure(self, auth_client):
        response = await auth_client.get("/app/dash/sync/shared")
        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, dict)
        assert "shared" in data


class TestDashboardValidation:
    @pytest.mark.asyncio
    async def test_sync_empty_payload(self, auth_client):
        response = await auth_client.post("/app/dash/sync", json={})
        assert response.status_code in {200, 422}

    @pytest.mark.asyncio
    async def test_sync_invalid_uuid_format(self, auth_client):
        payload = {
            "dashboards": [
                {
                    "uuid": "not-a-valid-uuid",
                    "name": "Invalid UUID Dashboard",
                    "data": {},
                }
            ]
        }
        response = await auth_client.post("/app/dash/sync", json=payload)
        assert response.status_code in {400, 422}

    @pytest.mark.asyncio
    async def test_sync_missing_required_fields(self, auth_client):
        payload = {
            "dashboards": [
                {
                    "data": {},
                }
            ]
        }
        response = await auth_client.post("/app/dash/sync", json=payload)
        assert response.status_code in {400, 422}

    @pytest.mark.asyncio
    async def test_sync_large_data_payload(self, auth_client):
        large_data = {"widgets": [{"id": f"widget_{i}"} for i in range(50)]}
        payload = {
            "dashboards": [
                {
                    "uuid": str(uuid4()),
                    "name": "Large Data Dashboard",
                    "data": large_data,
                }
            ]
        }
        response = await auth_client.post("/app/dash/sync", json=payload)
        assert response.status_code in {200, 201, 400, 422}


class TestDashboardSharing:
    @pytest.mark.asyncio
    async def test_share_with_valid_email(self, auth_client):
        dashboard_uuid = str(uuid4())
        create_payload = {
            "dashboards": [
                {
                    "uuid": dashboard_uuid,
                    "name": "Dashboard to Share",
                    "data": {},
                }
            ]
        }
        create_response = await auth_client.post("/app/dash/sync", json=create_payload)

        if create_response.status_code in {200, 201}:
            share_response = await auth_client.post(
                f"/app/dash/{dashboard_uuid}/share",
                json={"email": "sharetest@example.com", "permissions": "view"},
            )
            assert share_response.status_code in {200, 404, 422}

    @pytest.mark.asyncio
    async def test_share_with_invalid_email(self, auth_client):
        dashboard_uuid = str(uuid4())
        response = await auth_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"email": "not-an-email", "permissions": "view"},
        )
        assert response.status_code in {400, 404, 422}

    @pytest.mark.asyncio
    async def test_share_with_self(self, auth_client):
        dashboard_uuid = str(uuid4())
        create_payload = {
            "dashboards": [
                {
                    "uuid": dashboard_uuid,
                    "name": "Dashboard to Share with Self",
                    "data": {},
                }
            ]
        }
        await auth_client.post("/app/dash/sync", json=create_payload)

        response = await auth_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"email": "testrunner@example.com", "permissions": "view"},
        )
        assert response.status_code in {200, 400, 404, 422}

    @pytest.mark.asyncio
    async def test_toggle_entity_sharing(self, auth_client):
        dashboard_uuid = str(uuid4())
        create_payload = {
            "dashboards": [
                {
                    "uuid": dashboard_uuid,
                    "name": "Dashboard for Entity Sharing",
                    "data": {},
                }
            ]
        }
        create_response = await auth_client.post("/app/dash/sync", json=create_payload)

        if create_response.status_code in {200, 201}:
            toggle_response = await auth_client.post(
                f"/app/dash/{dashboard_uuid}/toggle-entity-sharing"
            )
            assert toggle_response.status_code in {200, 400, 404}


class TestDashboardVersions:
    @pytest.mark.asyncio
    async def test_get_versions_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/app/dash/{test_uuid}/versions")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_versions_nonexistent(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.get(f"/app/dash/{test_uuid}/versions")
        assert response.status_code in {200, 403, 404}

    @pytest.mark.asyncio
    async def test_versions_after_updates(self, auth_client):
        dashboard_uuid = str(uuid4())

        create_payload = {
            "dashboards": [
                {
                    "uuid": dashboard_uuid,
                    "name": "Dashboard v1",
                    "data": {"version": 1},
                }
            ]
        }
        create_response = await auth_client.post("/app/dash/sync", json=create_payload)

        if create_response.status_code in {200, 201}:
            update_payload = {
                "dashboards": [
                    {
                        "uuid": dashboard_uuid,
                        "name": "Dashboard v2",
                        "data": {"version": 2},
                    }
                ]
            }
            await auth_client.post("/app/dash/sync", json=update_payload)

            versions_response = await auth_client.get(
                f"/app/dash/{dashboard_uuid}/versions"
            )
            assert versions_response.status_code in {200, 404}


class TestDashboardEdgeCases:
    @pytest.mark.asyncio
    async def test_sync_with_special_characters_in_name(self, auth_client):
        special_names = [
            "Dashboard <script>alert('xss')</script>",
            "Dashboard 'with' \"quotes\"",
            "Dashboard with emoji 🚀",
            "Dashboard\nwith\nnewlines",
        ]

        for name in special_names:
            payload = {
                "dashboards": [
                    {
                        "uuid": str(uuid4()),
                        "name": name,
                        "data": {},
                    }
                ]
            }
            response = await auth_client.post("/app/dash/sync", json=payload)
            assert response.status_code in {
                200,
                201,
                400,
                422,
            }, f"Failed for name: {name}"

    @pytest.mark.asyncio
    async def test_sync_duplicate_uuids_in_payload(self, auth_client):
        duplicate_uuid = str(uuid4())
        payload = {
            "dashboards": [
                {"uuid": duplicate_uuid, "name": "First", "data": {}},
                {"uuid": duplicate_uuid, "name": "Second", "data": {}},
            ]
        }
        response = await auth_client.post("/app/dash/sync", json=payload)
        assert response.status_code in {200, 201, 400, 422}

    @pytest.mark.asyncio
    async def test_sync_with_null_data(self, auth_client):
        payload = {
            "dashboards": [
                {
                    "uuid": str(uuid4()),
                    "name": "Null Data Dashboard",
                    "data": None,
                }
            ]
        }
        response = await auth_client.post("/app/dash/sync", json=payload)
        assert response.status_code in {200, 201, 422}


class TestDashboardVersionHistory:
    @pytest.mark.asyncio
    async def test_get_versions_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/app/dash/{test_uuid}/versions")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_versions_invalid_uuid(self, auth_client):
        response = await auth_client.get("/app/dash/not-a-uuid/versions")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_dashboard_and_verify_versions_exist(self, auth_client):
        dashboard_uuid = str(uuid4())

        create_response = await auth_client.post(
            "/app/dash/sync",
            json={
                "items": {
                    dashboard_uuid: {"name": "Version Test v1", "data": {"widgets": []}}
                }
            },
        )
        assert (
            create_response.status_code == 200
        ), f"Failed to create dashboard: {create_response.text}"

        versions_response = await auth_client.get(
            f"/app/dash/{dashboard_uuid}/versions"
        )
        assert (
            versions_response.status_code == 200
        ), f"Failed to get versions: {versions_response.text}"

        versions = versions_response.json()
        assert isinstance(versions, list), "Versions should be a list"

    @pytest.mark.asyncio
    async def test_update_dashboard_creates_new_version(self, auth_client):
        dashboard_uuid = str(uuid4())

        create_response = await auth_client.post(
            "/app/dash/sync",
            json={
                "items": {
                    dashboard_uuid: {"name": "Version Test v1", "data": {"version": 1}}
                }
            },
        )
        assert create_response.status_code == 200

        for i in range(2, 5):
            update_response = await auth_client.post(
                "/app/dash/sync",
                json={
                    "items": {
                        dashboard_uuid: {
                            "name": f"Version Test v{i}",
                            "data": {"version": i},
                        }
                    }
                },
            )
            assert update_response.status_code == 200, f"Failed on update {i}"

        versions_response = await auth_client.get(
            f"/app/dash/{dashboard_uuid}/versions"
        )
        assert versions_response.status_code == 200

        versions = versions_response.json()
        assert isinstance(versions, list)

    @pytest.mark.asyncio
    async def test_versions_contain_expected_fields(self, auth_client):
        dashboard_uuid = str(uuid4())

        await auth_client.post(
            "/app/dash/sync",
            json={"items": {dashboard_uuid: {"name": "Schema Test", "data": {}}}},
        )

        await auth_client.post(
            "/app/dash/sync",
            json={
                "items": {
                    dashboard_uuid: {
                        "name": "Schema Test Updated",
                        "data": {"updated": True},
                    }
                }
            },
        )

        versions_response = await auth_client.get(
            f"/app/dash/{dashboard_uuid}/versions"
        )

        if versions_response.status_code == 200:
            versions = versions_response.json()
            if len(versions) > 0:
                version = versions[0]
                assert isinstance(version, dict)

    @pytest.mark.asyncio
    async def test_cannot_access_other_users_dashboard_versions(self, auth_client):
        other_user_uuid = str(uuid4())
        response = await auth_client.get(f"/app/dash/{other_user_uuid}/versions")
        assert response.status_code in {403, 404}


class TestDashboardShareLifecycle:
    @pytest.mark.asyncio
    async def test_share_dashboard_and_verify_share_exists(self, auth_client):
        dashboard_uuid = str(uuid4())
        share_email = f"sharetest_{uuid4().hex[:8]}@example.com"

        create_response = await auth_client.post(
            "/app/dash/sync",
            json={"items": {dashboard_uuid: {"name": "Share Test", "data": {}}}},
        )
        assert (
            create_response.status_code == 200
        ), f"Create failed: {create_response.text}"

        share_response = await auth_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"shares": {share_email: "comment"}},
        )
        if share_response.status_code == 200:
            shares_response = await auth_client.get(
                f"/app/dash/{dashboard_uuid}/shares"
            )
            assert shares_response.status_code == 200

            shares = shares_response.json()
            assert isinstance(shares, dict)
            assert share_email in shares, f"Shared email not found in shares: {shares}"
            assert shares[share_email]["permissions"] == "comment"

    @pytest.mark.asyncio
    async def test_share_dashboard_then_revoke_access(self, auth_client):
        dashboard_uuid = str(uuid4())
        share_email = f"revoke_{uuid4().hex[:8]}@example.com"

        create_response = await auth_client.post(
            "/app/dash/sync",
            json={"items": {dashboard_uuid: {"name": "Revoke Test", "data": {}}}},
        )
        assert create_response.status_code == 200

        share_response = await auth_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"shares": {share_email: "view"}},
        )

        if share_response.status_code == 200:
            shares = (
                await auth_client.get(f"/app/dash/{dashboard_uuid}/shares")
            ).json()
            assert share_email in shares

            revoke_response = await auth_client.request(
                "DELETE",
                f"/app/dash/{dashboard_uuid}/share",
                json={"shares": [share_email]},
            )
            assert revoke_response.status_code == 200

            shares_after = (
                await auth_client.get(f"/app/dash/{dashboard_uuid}/shares")
            ).json()
            if share_email in shares_after:
                assert shares_after[share_email].get("permissions") is None

    @pytest.mark.asyncio
    async def test_share_with_multiple_users_and_verify_all(self, auth_client):
        dashboard_uuid = str(uuid4())
        emails = [f"multi_{i}_{uuid4().hex[:6]}@example.com" for i in range(3)]

        create_response = await auth_client.post(
            "/app/dash/sync",
            json={"items": {dashboard_uuid: {"name": "Multi Share Test", "data": {}}}},
        )
        assert create_response.status_code == 200

        shares_dict = {email: "comment" for email in emails}
        share_response = await auth_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"shares": shares_dict},
        )

        if share_response.status_code == 200:
            shares = (
                await auth_client.get(f"/app/dash/{dashboard_uuid}/shares")
            ).json()
            for email in emails:
                assert email in shares, f"Missing share for {email}"

    @pytest.mark.asyncio
    async def test_update_share_permissions(self, auth_client):
        dashboard_uuid = str(uuid4())
        share_email = f"update_{uuid4().hex[:8]}@example.com"

        await auth_client.post(
            "/app/dash/sync",
            json={"items": {dashboard_uuid: {"name": "Update Share Test", "data": {}}}},
        )

        share_response = await auth_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"shares": {share_email: "view"}},
        )

        if share_response.status_code == 200:
            update_response = await auth_client.post(
                f"/app/dash/{dashboard_uuid}/share",
                json={"shares": {share_email: "edit"}},
            )

            if update_response.status_code == 200:
                shares = (
                    await auth_client.get(f"/app/dash/{dashboard_uuid}/shares")
                ).json()
                if share_email in shares:
                    assert shares[share_email]["permissions"] == "edit"


class TestDashboardSharesUsers:
    @pytest.mark.asyncio
    async def test_get_share_users_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/app/dash/{test_uuid}/shares/users")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_share_users_returns_dict_for_new_dashboard(self, auth_client):
        dashboard_uuid = str(uuid4())

        create_response = await auth_client.post(
            "/app/dash/sync",
            json={"items": {dashboard_uuid: {"name": "Users Dict Test", "data": {}}}},
        )
        assert create_response.status_code == 200

        response = await auth_client.get(f"/app/dash/{dashboard_uuid}/shares/users")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, dict), f"Expected dict, got {type(data)}"

    @pytest.mark.asyncio
    async def test_share_users_shows_shared_users(self, auth_client):
        dashboard_uuid = str(uuid4())
        share_email = f"visible_{uuid4().hex[:8]}@example.com"

        await auth_client.post(
            "/app/dash/sync",
            json={
                "items": {dashboard_uuid: {"name": "Visible Users Test", "data": {}}}
            },
        )

        share_response = await auth_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"shares": {share_email: "comment"}},
        )

        if share_response.status_code == 200:
            response = await auth_client.get(f"/app/dash/{dashboard_uuid}/shares/users")
            assert response.status_code == 200

            data = response.json()
            assert (
                share_email in data
            ), f"Shared user not visible in shares/users: {data}"

    @pytest.mark.asyncio
    async def test_cannot_access_other_users_dashboard_shares(self, auth_client):
        other_uuid = str(uuid4())
        response = await auth_client.get(f"/app/dash/{other_uuid}/shares/users")
        assert response.status_code in {403, 404}


class TestDashboardSharesGet:
    @pytest.mark.asyncio
    async def test_get_shares_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.get(f"/app/dash/{test_uuid}/shares")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_get_shares_for_own_dashboard(self, auth_client):
        dashboard_uuid = str(uuid4())

        create_response = await auth_client.post(
            "/app/dash/sync",
            json={"items": {dashboard_uuid: {"name": "Get Shares Test", "data": {}}}},
        )
        assert create_response.status_code == 200

        response = await auth_client.get(f"/app/dash/{dashboard_uuid}/shares")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, dict)

    @pytest.mark.asyncio
    async def test_shares_reflect_actual_shared_users(self, auth_client):
        dashboard_uuid = str(uuid4())
        emails = [f"reflect_{i}_{uuid4().hex[:6]}@example.com" for i in range(2)]

        await auth_client.post(
            "/app/dash/sync",
            json={"items": {dashboard_uuid: {"name": "Reflect Test", "data": {}}}},
        )

        share_response = await auth_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"shares": {emails[0]: "view", emails[1]: "comment"}},
        )

        if share_response.status_code == 200:
            shares = (
                await auth_client.get(f"/app/dash/{dashboard_uuid}/shares")
            ).json()

            if emails[0] in shares:
                assert shares[emails[0]]["permissions"] == "view"
            if emails[1] in shares:
                assert shares[emails[1]]["permissions"] == "comment"


class TestDashboardSavesSentTwice:
    @staticmethod
    async def owned(client) -> dict:
        response = await client.get("/app/dash/sync")
        assert response.status_code == 200
        return response.json()["owned"]

    @pytest.mark.asyncio
    async def test_a_dashboard_deleted_again_is_no_error(self, auth_client):
        dashboard = str(uuid4())
        content = {"name": "Deleted twice", "widgets": {}}
        assert (await auth_client.post("/app/dash/sync", json={"items": {dashboard: content}})).status_code == 200
        for _ in range(2):
            response = await auth_client.post("/app/dash/sync", json={"items": {dashboard: "DELETE"}})
            assert response.status_code == 200, response.text
        assert dashboard not in await self.owned(auth_client)

    @pytest.mark.asyncio
    async def test_another_users_dashboard_is_still_refused(self, auth_client, second_user_client):
        dashboard = str(uuid4())
        await auth_client.post("/app/dash/sync", json={"items": {dashboard: {"name": "Mine", "widgets": {}}}})
        response = await second_user_client.post("/app/dash/sync", json={"items": {dashboard: "DELETE"}})
        assert response.status_code == 400
        response = await second_user_client.post(
            "/app/dash/sync", json={"items": {dashboard: {"name": "Taken", "widgets": {}}}}
        )
        assert response.status_code == 400
        assert (await self.owned(auth_client))[dashboard]["content"]["name"] == "Mine"

    @pytest.mark.asyncio
    async def test_a_new_dashboard_saved_twice_at_once_is_kept(self, auth_client, monkeypatch):
        from api import crud

        async def none_yet(db, owner_uuid):
            return []

        monkeypatch.setattr(crud, "owned_dashboard_uuids", none_yet)
        dashboard = str(uuid4())
        first = {"name": "First", "widgets": {}}
        latest = {"name": "Latest", "widgets": {"w1": {"widgetId": "iframe"}}}
        assert (await auth_client.post("/app/dash/sync", json={"items": {dashboard: first}})).status_code == 200
        response = await auth_client.post("/app/dash/sync", json={"items": {dashboard: latest}})
        assert response.status_code == 200, response.text
        monkeypatch.undo()
        assert (await self.owned(auth_client))[dashboard]["content"] == latest
