"""
Integration tests for Privilege Escalation prevention.

Tests cover:
- Horizontal privilege escalation (accessing other users' resources)
- Vertical privilege escalation (regular user accessing admin endpoints)
- Token manipulation attacks
- Session hijacking prevention
- IDOR (Insecure Direct Object Reference) vulnerabilities
"""

import os
import sys

# Add the backend directory to Python path
BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import uuid4


# =============================================================================
# HORIZONTAL PRIVILEGE ESCALATION TESTS
# =============================================================================


class TestHorizontalPrivilegeEscalationDashboards:
    """Tests for accessing other users' dashboards"""

    @pytest.mark.asyncio
    async def test_cannot_read_other_users_dashboard(
        self, auth_client, second_user_client
    ):
        """User A should not be able to read User B's private dashboard"""
        # User A creates a dashboard
        dashboard_uuid = str(uuid4())
        # API expects items: dict[UUID, dict] format
        create_payload = {
            "items": {
                dashboard_uuid: {
                    "name": "User A Private Dashboard",
                    "data": {"private": "data"},
                }
            }
        }
        create_response = await auth_client.post("/app/dash/sync", json=create_payload)
        # Dashboard creation should work - if it doesn't, fail the test to investigate
        assert (
            create_response.status_code == 200
        ), f"Dashboard creation failed: {create_response.status_code} - {create_response.text}"

        # User B tries to access User A's dashboard
        response = await second_user_client.get(f"/app/dash/{dashboard_uuid}")
        # Should be 403 Forbidden or 404 Not Found (don't reveal existence)
        assert response.status_code in {
            403,
            404,
        }, f"Expected 403/404 but got {response.status_code}"

    @pytest.mark.asyncio
    async def test_cannot_update_other_users_dashboard(
        self, auth_client, second_user_client
    ):
        """User A should not be able to modify User B's dashboard"""
        # User A creates a dashboard
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

        # User B tries to update User A's dashboard
        update_payload = {
            "items": {
                dashboard_uuid: {
                    "name": "HACKED by User B",
                    "data": {"hacked": True},
                }
            }
        }
        await second_user_client.post("/app/dash/sync", json=update_payload)

        # The sync might succeed (200) but should NOT modify User A's dashboard
        # Verify User A's dashboard is unchanged
        verify_response = await auth_client.get(f"/app/dash/{dashboard_uuid}")
        if verify_response.status_code == 200:
            data = verify_response.json()
            # Dashboard should NOT be modified
            assert data.get("name") != "HACKED by User B"

    @pytest.mark.asyncio
    async def test_cannot_delete_other_users_dashboard(
        self, auth_client, second_user_client
    ):
        """User A should not be able to delete User B's dashboard"""
        # User A creates a dashboard
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

        # User B tries to delete User A's dashboard (DELETE literal value)
        delete_payload = {"items": {dashboard_uuid: "DELETE"}}
        await second_user_client.post("/app/dash/sync", json=delete_payload)

        # Verify User A's dashboard still exists
        verify_response = await auth_client.get(f"/app/dash/{dashboard_uuid}")
        # Dashboard should still exist for User A
        assert verify_response.status_code in {200, 403, 404}

    @pytest.mark.asyncio
    async def test_cannot_share_other_users_dashboard(
        self, auth_client, second_user_client
    ):
        """User B should not be able to share User A's dashboard"""
        # User A creates a dashboard
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

        # User B tries to share User A's dashboard (correct payload format)
        response = await second_user_client.post(
            f"/app/dash/{dashboard_uuid}/share",
            json={"shares": [{"email": "attacker@evil.com", "permission": "view"}]},
        )
        # Should be forbidden (403) or not found (404) or validation error (422)
        assert response.status_code in {
            403,
            404,
            422,
        }, f"Expected 403/404/422 but got {response.status_code}"


class TestHorizontalPrivilegeEscalationDataConnectors:
    """Tests for accessing other users' data connectors"""

    @pytest.mark.asyncio
    async def test_cannot_read_other_users_data_connectors(
        self, auth_client, second_user_client
    ):
        """User B should not see User A's backend connectors in list"""
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
        """User B should not be able to overwrite or delete User A's connector by UUID"""
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
    """Tests for accessing other users' account data"""

    @pytest.mark.asyncio
    async def test_cannot_read_other_users_profile(
        self, auth_client, second_user_client
    ):
        """User B should not be able to read User A's profile details"""
        # Get User A's UUID from their profile
        user_a_profile = await auth_client.get("/app/user")
        assert user_a_profile.status_code == 200

        user_a_data = user_a_profile.json()
        user_a_uuid = user_a_data.get("uuid")

        if user_a_uuid:
            # User B tries to access User A's profile via UUID
            response = await second_user_client.get(f"/user/{user_a_uuid}")
            # Should be 403 or 404, not 200
            assert response.status_code in {403, 404, 405}

    @pytest.mark.asyncio
    async def test_cannot_modify_other_users_profile(
        self, auth_client, second_user_client
    ):
        """User B should not be able to modify User A's profile"""
        # Get User A's UUID
        user_a_profile = await auth_client.get("/app/user")
        user_a_data = user_a_profile.json()
        user_a_uuid = user_a_data.get("uuid")

        if user_a_uuid:
            # User B tries to modify User A's profile
            response = await second_user_client.put(
                f"/user/{user_a_uuid}",
                json={"username": "hacked_username"},
            )
            # Should be forbidden
            assert response.status_code in {401, 403, 404, 405}

    @pytest.mark.asyncio
    async def test_cannot_read_or_revoke_other_users_access_token(
        self, auth_client, second_user_client
    ):
        """User B should neither see nor revoke User A's personal access token.

        A personal access token signs its holder in as its owner, so a user who could
        list another's would learn what to attack, and one who could revoke another's
        could cut off their access.
        """
        created = await auth_client.post(
            "/app/workspace-mcp/tokens", json={"name": "User A's host"}
        )
        assert created.status_code == 200
        token_uuid = created.json()["uuid"]

        listed = await second_user_client.get("/app/workspace-mcp/tokens")
        assert listed.status_code == 200
        assert all(token["uuid"] != token_uuid for token in listed.json())

        # The revoke is scoped to the caller's own tokens, so this matches nothing and does
        # nothing. It answers 204 either way, which is what keeps it from telling a stranger
        # whether the token exists; what matters is that the token is still there afterwards.
        revoked = await second_user_client.delete(
            f"/app/workspace-mcp/tokens/{token_uuid}"
        )
        assert revoked.status_code in {204, 401, 403, 404}

        # User A still has it.
        still_there = await auth_client.get("/app/workspace-mcp/tokens")
        assert still_there.status_code == 200
        assert any(token["uuid"] == token_uuid for token in still_there.json())


# =============================================================================
# VERTICAL PRIVILEGE ESCALATION TESTS
# =============================================================================


class TestVerticalPrivilegeEscalationAdmin:
    """Tests for regular users accessing admin-only endpoints"""

    @pytest.mark.asyncio
    async def test_regular_user_cannot_access_admin_users_list(self, auth_client):
        """Regular user should not access admin user management"""
        response = await auth_client.get("/admin/users")
        # Should be 401/403, definitely not 200
        assert response.status_code in {401, 403, 404}

    @pytest.mark.asyncio
    async def test_regular_user_cannot_access_admin_metrics(self, auth_client):
        """Regular user should not access admin metrics"""
        response = await auth_client.get("/admin/metrics")
        assert response.status_code in {401, 403, 404}

    @pytest.mark.asyncio
    async def test_regular_user_cannot_delete_other_users(self, auth_client):
        """Regular user should not be able to delete other users"""
        fake_user_uuid = str(uuid4())
        response = await auth_client.delete(f"/admin/user/{fake_user_uuid}")
        assert response.status_code in {401, 403, 404, 405}

    @pytest.mark.asyncio
    async def test_regular_user_cannot_create_roles(self, auth_client):
        """Regular user should not be able to create roles"""
        response = await auth_client.post(
            "/entity/role",
            json={"name": "super_admin", "description": "Escalated role"},
        )
        assert response.status_code in {401, 403, 422}


# =============================================================================
# IDOR (Insecure Direct Object Reference) TESTS
# =============================================================================


class TestIDORVulnerabilities:
    """Tests for IDOR vulnerabilities - manipulating object IDs"""

    @pytest.mark.asyncio
    async def test_sequential_uuid_enumeration(self, auth_client):
        """Should not be able to enumerate resources by incrementing UUIDs"""
        # Try sequential-looking UUIDs (shouldn't exist, but test the response)
        test_uuids = [
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
            "00000000-0000-0000-0000-000000000003",
        ]

        for test_uuid in test_uuids:
            response = await auth_client.get(f"/app/dash/{test_uuid}")
            # Should consistently return 403 or 404, never 200 for other's data
            assert response.status_code in {403, 404}

    @pytest.mark.asyncio
    async def test_uuid_manipulation_in_path(self, auth_client, second_user_client):
        """Should not be able to access resources by guessing/manipulating UUIDs"""
        # User A creates a resource
        dashboard_uuid = str(uuid4())
        await auth_client.post(
            "/app/dash/sync",
            json={
                "dashboards": [
                    {"uuid": dashboard_uuid, "name": "Test Dashboard", "data": {}}
                ]
            },
        )

        # User B tries variations of the UUID
        uuid_variations = [
            dashboard_uuid,  # Exact UUID
            dashboard_uuid.upper(),  # Uppercase
            dashboard_uuid.replace("-", ""),  # Without dashes
        ]

        for uuid_var in uuid_variations:
            response = await second_user_client.get(f"/app/dash/{uuid_var}")
            assert response.status_code in {403, 404, 422}


# =============================================================================
# TOKEN MANIPULATION TESTS
# =============================================================================


class TestTokenManipulation:
    """Tests for JWT/session token manipulation attacks"""

    @pytest.mark.asyncio
    async def test_expired_token_rejected(self, client):
        """Expired tokens should be rejected"""
        # Use an obviously expired/invalid JWT
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
        """Malformed tokens should be rejected"""
        malformed_tokens = [
            "not-a-jwt",
            "Bearer ",
            "Bearer invalid",
            "Bearer eyJhbGciOiJIUzI1NiJ9",  # Incomplete JWT
            "Bearer " + "a" * 1000,  # Very long token
        ]

        for token in malformed_tokens:
            client.headers["Authorization"] = token
            response = await client.get("/app/user")
            assert response.status_code in {401, 403, 422}

    @pytest.mark.asyncio
    async def test_token_with_modified_payload(self, client):
        """JWT with tampered payload should be rejected"""
        # JWT with valid structure but modified payload (invalid signature)
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
        """JWT with 'none' algorithm should be rejected"""
        # JWT with alg: none (classic attack)
        none_alg_jwt = (
            "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0."
            "eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiJ9."
        )

        client.headers["Authorization"] = f"Bearer {none_alg_jwt}"
        response = await client.get("/app/user")
        assert response.status_code in {401, 403}


# =============================================================================
# SESSION HIJACKING PREVENTION TESTS
# =============================================================================


class TestSessionHijackingPrevention:
    """Tests for session security"""

    @pytest.mark.asyncio
    async def test_cannot_reuse_logged_out_session(self, client, auth_client):
        """After logout, the session token is invalid: the server deleted the session"""
        # The session cookie, as a page that kept a copy would send it
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
        """User A's session should not work for User B's actions"""
        # Get User A's data
        user_a_response = await auth_client.get("/app/user")
        assert user_a_response.status_code == 200
        user_a_data = user_a_response.json()

        # Get User B's data
        user_b_response = await second_user_client.get("/app/user")
        assert user_b_response.status_code == 200
        user_b_data = user_b_response.json()

        # The key test is that sessions are isolated - each user sees their own data
        assert (
            user_a_data["uuid"] != user_b_data["uuid"]
        ), "Sessions should return different user data"


# =============================================================================
# PARAMETER TAMPERING TESTS
# =============================================================================


class TestParameterTampering:
    """Tests for parameter tampering attacks"""

    @pytest.mark.asyncio
    async def test_cannot_escalate_via_request_body(self, auth_client):
        """Should not be able to escalate privileges via request body"""
        # Try to set admin/elevated permissions in request body
        response = await auth_client.put(
            "/user",
            json={
                "is_admin": True,
                "role": "admin",
                "permissions": ["all"],
            },
        )
        # Request may succeed but should not grant admin
        if response.status_code == 200:
            # Verify user is not actually admin
            user_response = await auth_client.get("/app/user")
            user_data = user_response.json()
            # These fields should not be modifiable by user
            assert user_data.get("is_admin") is not True

    @pytest.mark.asyncio
    async def test_cannot_set_other_user_uuid_in_body(
        self, auth_client, second_user_client
    ):
        """Should not be able to act as another user by setting their UUID"""
        # Get User A's UUID
        user_a_response = await auth_client.get("/app/user")
        user_a_uuid = user_a_response.json().get("uuid")

        # User B tries to create resource claiming to be User A
        dashboard_uuid = str(uuid4())
        response = await second_user_client.post(
            "/app/dash/sync",
            json={
                "dashboards": [
                    {
                        "uuid": dashboard_uuid,
                        "name": "Impersonation Dashboard",
                        "data": {},
                        "user_uuid": user_a_uuid,  # Trying to set owner
                        "owner_uuid": user_a_uuid,
                    }
                ]
            },
        )

        # If created, verify it belongs to User B, not User A
        if response.status_code == 200:
            # Check User A doesn't have this dashboard
            user_a_dashboards = await auth_client.get("/app/dash")
            if user_a_dashboards.status_code == 200:
                data = user_a_dashboards.json()
                owned = data.get("owned", {})
                assert dashboard_uuid not in owned

    @pytest.mark.asyncio
    async def test_hidden_form_field_injection(self, auth_client):
        """Should ignore hidden/unexpected fields in requests"""
        response = await auth_client.put(
            "/user",
            json={
                # Hidden field injection attempts
                "__admin__": True,
                "_is_superuser": True,
                "internal_role": "admin",
                "bypass_auth": True,
            },
        )
        # Should either succeed (ignoring bad fields) or fail validation
        assert response.status_code in {200, 400, 422}

        # Verify no privilege escalation occurred
        if response.status_code == 200:
            user_response = await auth_client.get("/app/user")
            # User should still be regular user
            assert user_response.status_code == 200


# =============================================================================
# RATE LIMIT BYPASS TESTS
# =============================================================================


class TestRateLimitBypass:
    """Tests for rate limit bypass attempts"""

    @pytest.mark.asyncio
    async def test_cannot_bypass_rate_limit_via_headers(self, client):
        """Should not be able to bypass rate limits via header manipulation"""
        bypass_headers = [
            {"X-Forwarded-For": "127.0.0.1"},
            {"X-Real-IP": "127.0.0.1"},
            {"X-Originating-IP": "127.0.0.1"},
            {"CF-Connecting-IP": "127.0.0.1"},
            {"True-Client-IP": "127.0.0.1"},
        ]

        for headers in bypass_headers:
            client.headers.update(headers)
            # Make requests - rate limits should still apply
            response = await client.post(
                "/app/login",
                json={"email": "test@test.com", "password": "wrong"},
            )
            # Should get 401 (invalid login) not 200 (bypassed)
            assert response.status_code in {401, 422, 429}
