import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import pytest
from uuid import uuid4


def _build_skill_payload(*, skill_id: str | None = None, slug: str | None = None) -> dict:
    suffix = str(uuid4())[:8]
    return {
        "id": skill_id or str(uuid4()),
        "slug": slug or f"skill-{suffix}",
        "description": f"Skill description {suffix}",
        "content": f"# Skill {suffix}\n\nBody",
        "createdAt": "2026-02-19T00:00:00.000Z",
        "updatedAt": "2026-02-19T00:00:00.000Z",
    }


class TestCustomCopilot:
    @pytest.mark.asyncio
    async def test_get_copilots_unauthenticated(self, client):
        response = await client.get("/app/custom-copilot")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_copilots_authenticated(self, auth_client):
        response = await auth_client.get("/app/custom-copilot")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type

    @pytest.mark.asyncio
    async def test_update_copilot_unauthenticated(self, client):
        response = await client.put("/app/custom-copilot", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_update_copilot_authenticated(self, auth_client):
        response = await auth_client.put("/app/custom-copilot", json={"name": "test_copilot", "config": {}})
        assert response.status_code in {200, 422}

    @pytest.mark.asyncio
    async def test_delete_copilot_unauthenticated(self, client):
        test_uuid = str(uuid4())
        response = await client.delete(f"/app/custom-copilot/{test_uuid}")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_delete_copilot_nonexistent(self, auth_client):
        test_uuid = str(uuid4())
        response = await auth_client.delete(f"/app/custom-copilot/{test_uuid}")
        assert response.status_code in {200, 404}


class TestCopilotChats:
    @pytest.mark.asyncio
    async def test_the_sync_serves_saved_chats(self, auth_client):
        chat_uuid = str(uuid4())
        response = await auth_client.post(
            "/app/copilot-chats",
            json={"chats": {chat_uuid: {"createdAt": 1771459200000, "label": "Saved"}}},
        )
        assert response.status_code == 200, response.text

        synced = await auth_client.get("/app/dash/validate-and-sync")
        assert synced.status_code == 200
        assert chat_uuid in [chat["uuid"] for chat in synced.json()["copilot_chats"]]

    @pytest.mark.asyncio
    async def test_save_chats_unauthenticated(self, client):
        response = await client.post("/app/copilot-chats", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_save_chats_authenticated(self, auth_client):
        response = await auth_client.post("/app/copilot-chats", json={"chats": []})
        assert response.status_code in {200, 422}


class TestPrompts:
    @pytest.mark.asyncio
    async def test_get_prompts_unauthenticated(self, client):
        response = await client.get("/app/prompts")
        assert response.status_code in {401, 403}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_get_prompts_authenticated(self, auth_client):
        response = await auth_client.get("/app/prompts")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type

    @pytest.mark.asyncio
    async def test_save_prompts_unauthenticated(self, client):
        response = await client.post("/app/prompts", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_save_prompts_authenticated(self, auth_client):
        response = await auth_client.post("/app/prompts", json={"prompts": []})
        assert response.status_code in {200, 422}


class TestSkills:
    @pytest.mark.asyncio
    async def test_save_skills_unauthenticated(self, client):
        response = await client.post("/app/skills", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_save_skills_authenticated(self, auth_client):
        payload = _build_skill_payload()
        response = await auth_client.post("/app/skills", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert any(skill.get("slug") == payload["slug"] for skill in data)

    @pytest.mark.asyncio
    async def test_skills_roundtrip(self, auth_client):
        payload = _build_skill_payload()
        save_response = await auth_client.post("/app/skills", json=payload)
        assert save_response.status_code == 200

        sync_response = await auth_client.get("/app/dash/validate-and-sync")
        assert sync_response.status_code == 200
        saved_skills = sync_response.json()["user_skills"]
        assert isinstance(saved_skills, list)
        assert any(skill.get("slug") == payload["slug"] for skill in saved_skills)

    @pytest.mark.asyncio
    async def test_duplicate_skill_slug_rejected(self, auth_client):
        slug = f"dup-{str(uuid4())[:8]}"
        payload = _build_skill_payload(skill_id=str(uuid4()), slug=slug)

        response1 = await auth_client.post("/app/skills", json=payload)
        assert response1.status_code == 200

        response2 = await auth_client.post("/app/skills", json=payload)
        assert response2.status_code in {400, 422, 500}

    @pytest.mark.asyncio
    async def test_same_slug_allowed_for_different_users(self, auth_client, second_user_client):
        shared_slug = f"shared-{str(uuid4())[:8]}"

        first_response = await auth_client.post(
            "/app/skills",
            json=_build_skill_payload(slug=shared_slug),
        )
        assert first_response.status_code == 200

        second_response = await second_user_client.post(
            "/app/skills",
            json=_build_skill_payload(slug=shared_slug),
        )
        assert second_response.status_code == 200


class TestMcpServers:
    @pytest.mark.asyncio
    async def test_save_mcp_config_unauthenticated(self, client):
        response = await client.post("/app/mcp-servers", json={})
        assert response.status_code in {401, 403, 422}
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data

    @pytest.mark.asyncio
    async def test_save_mcp_config_authenticated(self, auth_client):
        response = await auth_client.post("/app/mcp-servers", json={"servers": []})
        assert response.status_code in {200, 422}
