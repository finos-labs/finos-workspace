"""Tests for the admin notification hook (api/notifications.py) and the events wired to it."""

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest

from api import notifications
from api.notifications import WebhookNotifier, notify_admins
from tests.fixtures.base import _TEST_ENTITY_TYPE_UUID
from tests.fixtures.base import superuser_override
from utilities.config import settings


_RealAsyncClient = httpx.AsyncClient


def _mock_client(handler):
    """An httpx.AsyncClient factory whose requests go to `handler`."""

    def factory(**kwargs):
        return _RealAsyncClient(transport=httpx.MockTransport(handler), **kwargs)

    return factory


class _RecordingNotifier:
    configured = True

    def __init__(self, result: bool = True):
        self.result = result
        self.calls: list[tuple] = []

    async def notify(self, event, subject, text, payload):
        self.calls.append((event, subject, text, payload))
        return self.result


class TestWebhookNotifier:
    @pytest.mark.asyncio
    async def test_posts_signed_json(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(204)

        notifier = WebhookNotifier(url="https://hooks.example.com/admin", secret="s3cret")
        with patch.object(notifications.httpx, "AsyncClient", _mock_client(handler)):
            sent = await notifier.notify("test.event", "Subject", "Body", {"a": 1})

        assert sent is True
        (request,) = requests
        assert str(request.url) == "https://hooks.example.com/admin"
        body = json.loads(request.content)
        assert body["event"] == "test.event"
        assert body["subject"] == "Subject"
        assert body["text"] == "Body"
        assert body["payload"] == {"a": 1}
        assert datetime.fromisoformat(body["occurred_at"])
        expected = hmac.new(b"s3cret", request.content, hashlib.sha256).hexdigest()
        assert request.headers[notifications.SIGNATURE_HEADER] == f"sha256={expected}"

    @pytest.mark.asyncio
    async def test_unsigned_without_secret(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200)

        notifier = WebhookNotifier(url="https://hooks.example.com/admin", secret="")
        with patch.object(notifications.httpx, "AsyncClient", _mock_client(handler)):
            assert await notifier.notify("e", "s", "t", {}) is True
        assert notifications.SIGNATURE_HEADER not in requests[0].headers

    @pytest.mark.asyncio
    async def test_http_error_is_a_failure(self):
        notifier = WebhookNotifier(url="https://hooks.example.com/admin", secret="")
        with patch.object(
            notifications.httpx, "AsyncClient", _mock_client(lambda r: httpx.Response(500))
        ):
            assert await notifier.notify("e", "s", "t", {}) is False

    @pytest.mark.asyncio
    async def test_connection_error_is_a_failure(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("unreachable", request=request)

        notifier = WebhookNotifier(url="https://hooks.example.com/admin", secret="")
        with patch.object(notifications.httpx, "AsyncClient", _mock_client(handler)):
            assert await notifier.notify("e", "s", "t", {}) is False

    def test_not_configured_without_url(self):
        assert WebhookNotifier(url="").configured is False


class TestNotifyAdmins:
    @pytest.mark.asyncio
    async def test_returns_none_when_not_configured(self):
        with patch.object(notifications, "get_notifier", lambda: WebhookNotifier(url="")):
            assert await notify_admins("e", "s", "t", {}) is None

    @pytest.mark.asyncio
    async def test_adds_recipient_and_sender(self, monkeypatch):
        recorder = _RecordingNotifier()
        monkeypatch.setattr(settings, "ADMIN_NOTIFY_RECIPIENT", "reviewers@example.com")
        monkeypatch.setattr(settings, "ADMIN_NOTIFY_SENDER", "workspace@example.com")
        with patch.object(notifications, "get_notifier", lambda: recorder):
            assert await notify_admins("e", "s", "t", {"k": "v"}) is True
        (_, _, _, payload) = recorder.calls[0]
        assert payload == {
            "recipient": "reviewers@example.com",
            "sender": "workspace@example.com",
            "k": "v",
        }

    def test_transport_is_loaded_from_the_import_path(self, monkeypatch):
        monkeypatch.setattr(
            settings, "ADMIN_NOTIFIER", "tests.test_admin_notifications:_RecordingNotifier"
        )
        notifications.get_notifier.cache_clear()
        try:
            assert isinstance(notifications.get_notifier(), _RecordingNotifier)
        finally:
            notifications.get_notifier.cache_clear()


class TestEntityCreatedEvent:
    @pytest.mark.asyncio
    async def test_entity_creation_notifies_the_admins(self, auth_client):
        name = f"Notify Entity {uuid4().hex[:8]}"
        mock = AsyncMock(return_value=None)
        with superuser_override(), patch("routers.entity.notify_admins", mock):
            response = await auth_client.post(
                "/entity/entity",
                json={
                    "name": name,
                    "entity_code": _TEST_ENTITY_TYPE_UUID,
                    "email": "entity@example.com",
                    "company_type": "other",
                    "organization_size": "1-10",
                    "aum": 0,
                    "country": "US",
                    "seats": 5,
                    "expiration_date": (datetime.now(UTC) + timedelta(days=30)).isoformat(),
                    "admin_email": "entity-admin@example.com",
                },
            )
            assert response.status_code == 200, response.text
            entity_uuid = response.json()["entity_uuid"]
            await auth_client.delete(f"/entity/entity/{entity_uuid}")

        mock.assert_awaited_once()
        event, _subject, _text, payload = mock.await_args.args
        assert event == "entity.created"
        assert payload == {"entity_name": name, "admin_email": "entity-admin@example.com"}
