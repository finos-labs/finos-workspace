"""
Integration tests for Entity Management endpoints.

Tests cover:
- Entity: CRUD operations; an entity is a name and its sharing switch
- Entity Relationships: creation and management
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

from tests.fixtures.base import superuser_override


class TestEntityValidate:
    """Tests for GET /entity/validate, the probe that shows entity management"""

    @pytest.mark.asyncio
    async def test_validate_unauthenticated(self, client):
        response = await client.get("/entity/validate")
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_validate_rejects_a_user_who_is_not_a_superuser(self, auth_client):
        response = await auth_client.get("/entity/validate")
        assert response.status_code == 403
        assert response.json()["detail"] == "User is not a superuser"

        # The user stays signed in
        assert (await auth_client.get("/app/access")).status_code == 200

    @pytest.mark.asyncio
    async def test_validate_accepts_a_superuser(self, auth_client):
        with superuser_override():
            response = await auth_client.get("/entity/validate")
        assert response.status_code == 200
        assert response.json()["success"] is True


class TestEntityList:
    """Tests for GET /entity/entity endpoint"""

    @pytest.mark.asyncio
    async def test_list_entities_unauthenticated(self, client):
        """Should fail without auth"""
        response = await client.get("/entity/entity")
        assert response.status_code in {401, 403}
        # Validate error response structure
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_list_entities_authenticated(self, auth_client):
        """Should return entities list based on permissions"""
        response = await auth_client.get("/entity/entity")
        # 200 for success, 401/403 if not admin
        assert response.status_code in {200, 401, 403}

        if response.status_code == 200:
            data = response.json()
            assert isinstance(data, (list, dict))


class TestEntityCreate:
    """Tests for POST /entity/entity endpoint"""

    @pytest.mark.asyncio
    async def test_create_entity_unauthenticated(self, client):
        """Should fail without auth"""
        response = await client.post(
            "/entity/entity",
            json={"name": "Test Entity", "admin_email": "admin@example.com"},
        )
        assert response.status_code in {401, 403, 422}
        # Validate error response structure
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_a_superuser_creates_an_entity_with_a_name(self, auth_client):
        """An entity is its name and its sharing switch, which is on unless given"""
        name = f"Test Entity {uuid4().hex[:8]}"
        with superuser_override():
            response = await auth_client.post(
                "/entity/entity", json={"name": name, "admin_email": "admin@example.com"}
            )
            assert response.status_code == 200, response.text
            entity_uuid = response.json()["entity_uuid"]
            try:
                listed = (await auth_client.get("/entity/entity", params={"size": 1000})).json()
                [entity] = [item for item in listed["items"] if item["uuid"] == entity_uuid]
                assert entity == {"uuid": entity_uuid, "name": name, "sharing_enabled": True}
            finally:
                await auth_client.delete(f"/entity/entity/{entity_uuid}")

    @pytest.mark.asyncio
    async def test_a_name_is_taken_once(self, auth_client):
        name = f"Test Entity {uuid4().hex[:8]}"
        body = {"name": name, "admin_email": "admin@example.com"}
        with superuser_override():
            first = await auth_client.post("/entity/entity", json=body)
            try:
                second = await auth_client.post("/entity/entity", json=body)

                assert second.status_code == 409
                assert second.json()["detail"] == "An entity with this name already exists"
            finally:
                await auth_client.delete(f"/entity/entity/{first.json()['entity_uuid']}")

    @pytest.mark.asyncio
    async def test_the_removed_details_are_refused(self, auth_client):
        """Its type, email, company type, size, AUM and country are gone"""
        with superuser_override():
            for field, value in (
                ("entity_code", str(uuid4())),
                ("email", "entity@example.com"),
                ("company_type", "other"),
                ("organization_size", "1-10"),
                ("aum", 0),
                ("country", "US"),
            ):
                response = await auth_client.post(
                    "/entity/entity",
                    json={
                        "name": f"Test Entity {uuid4().hex[:8]}",
                        "admin_email": "admin@example.com",
                        field: value,
                    },
                )
                assert response.status_code == 422, field

    @pytest.mark.asyncio
    async def test_create_entity_missing_required_fields(self, auth_client):
        """Should fail with missing required fields"""
        response = await auth_client.post("/entity/entity", json={})
        assert response.status_code in {401, 403, 422}
        # Validate error response structure
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data


class TestEntityUpdate:
    """Tests for PUT /entity/entity/{entity_uuid} endpoint"""

    @pytest.mark.asyncio
    async def test_update_entity_unauthenticated(self, client):
        """Should fail without auth"""
        test_uuid = str(uuid4())
        response = await client.put(
            f"/entity/entity/{test_uuid}",
            json={"name": "Updated Entity"},
        )
        assert response.status_code in {401, 403, 422}
        # Validate error response structure
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_update_entity_nonexistent(self, auth_client):
        """Should return 404 for nonexistent entity (if admin)"""
        test_uuid = str(uuid4())
        response = await auth_client.put(
            f"/entity/entity/{test_uuid}",
            json={"name": "Updated Entity"},
        )
        # 401/403 if not admin, 404 if admin and not found
        assert response.status_code in {401, 403, 404, 422}


class TestEntityRelationship:
    """Tests for /entity/entity-relationship endpoints"""

    @pytest.mark.asyncio
    async def test_get_relationships_unauthenticated(self, client):
        """Should fail without auth"""
        response = await client.get("/entity/entity-relationship")
        assert response.status_code in {401, 403}
        # Validate error response structure
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_relationships_authenticated(self, auth_client):
        """Should return entity relationships (if admin)"""
        response = await auth_client.get("/entity/entity-relationship")
        # 401/403 if not admin
        assert response.status_code in {200, 401, 403}

    @pytest.mark.asyncio
    async def test_create_relationship_unauthenticated(self, client):
        """Should fail without auth"""
        response = await client.post(
            "/entity/entity-relationship",
            json={
                "parent_entity_uuid": str(uuid4()),
                "child_entity_uuid": str(uuid4()),
            },
        )
        assert response.status_code in {401, 403, 422}

    @pytest.mark.asyncio
    async def test_create_relationship_authenticated(self, auth_client):
        """Should create entity relationship (if admin)"""
        response = await auth_client.post(
            "/entity/entity-relationship",
            json={
                "parent_entity_uuid": str(uuid4()),
                "child_entity_uuid": str(uuid4()),
            },
        )
        # 401/403 if not admin, 404 for nonexistent entities
        assert response.status_code in {200, 201, 401, 403, 404, 422}

    @pytest.mark.asyncio
    async def test_update_relationship_unauthenticated(self, client):
        """Should fail without auth"""
        test_uuid = str(uuid4())
        response = await client.put(
            f"/entity/entity-relationship/{test_uuid}",
            json={"active": False},
        )
        assert response.status_code in {401, 403, 422}


class TestEntityValidation:
    """Input validation tests for entity endpoints (require admin)"""

    @pytest.mark.asyncio
    async def test_entity_name_empty(self, auth_client):
        """Entity with empty name should fail (if admin)"""
        response = await auth_client.post(
            "/entity/entity",
            json={"name": "", "admin_email": "admin@example.com"},
        )
        # 401/403 if not admin, 422 if validation fails
        assert response.status_code in {401, 403, 422}
