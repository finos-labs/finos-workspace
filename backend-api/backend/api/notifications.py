"""Admin notifications: a pluggable transport for events administrators should hear about.

`ADMIN_NOTIFIER` names the transport class by import path (`package.module:Class`); the default is
`WebhookNotifier`, which POSTs each notification as JSON to `ADMIN_NOTIFY_WEBHOOK_URL`. With no
webhook URL configured, notifications are logged and dropped.

Events:
- `marketplace.listing.submitted`: a developer asked for review of a marketplace listing.
- `entity.created`: an entity was created; the payload carries `admin_email` and `entity_name`.
"""

import hashlib
import hmac
import json
from datetime import UTC, datetime
from functools import cache
from importlib import import_module
from typing import Any, Protocol

import httpx
from loguru import logger

from utilities.config import settings

SIGNATURE_HEADER = "X-Admin-Notification-Signature"


class AdminNotifier(Protocol):
    """A notification transport. `notify` returns True when the notification was delivered."""

    @property
    def configured(self) -> bool: ...

    async def notify(
        self, event: str, subject: str, text: str, payload: dict[str, Any]
    ) -> bool: ...


class WebhookNotifier:
    """POSTs `{event, subject, text, payload, occurred_at}` as JSON to the configured URL.

    When `ADMIN_NOTIFY_WEBHOOK_SECRET` is set, the body is signed with HMAC-SHA256 and the
    signature is sent as `X-Admin-Notification-Signature: sha256=<hex digest>`.
    """

    timeout_seconds = 10.0

    def __init__(self, url: str | None = None, secret: str | None = None):
        self.url = url if url is not None else settings.ADMIN_NOTIFY_WEBHOOK_URL
        self.secret = (
            secret if secret is not None else settings.ADMIN_NOTIFY_WEBHOOK_SECRET
        )

    @property
    def configured(self) -> bool:
        return bool(self.url)

    async def notify(
        self, event: str, subject: str, text: str, payload: dict[str, Any]
    ) -> bool:
        body = json.dumps(
            {
                "event": event,
                "subject": subject,
                "text": text,
                "payload": payload,
                "occurred_at": datetime.now(UTC).isoformat(),
            },
            default=str,
        ).encode()
        headers = {"Content-Type": "application/json"}
        if self.secret:
            digest = hmac.new(self.secret.encode(), body, hashlib.sha256).hexdigest()
            headers[SIGNATURE_HEADER] = f"sha256={digest}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(self.url, content=body, headers=headers)
        except httpx.HTTPError as exc:
            logger.error(f"Admin notification {event} failed: {exc}")
            return False
        if response.is_error:
            logger.error(
                f"Admin notification {event} failed: HTTP {response.status_code}"
            )
            return False
        return True


@cache
def get_notifier() -> AdminNotifier:
    """The transport named by `ADMIN_NOTIFIER`."""
    module_name, _, class_name = settings.ADMIN_NOTIFIER.partition(":")
    return getattr(import_module(module_name), class_name)()


async def notify_admins(
    event: str, subject: str, text: str, payload: dict[str, Any]
) -> bool | None:
    """Send an admin notification.

    Returns None when no notifier is configured, otherwise whether it was delivered. The
    configured recipient and sender travel in the payload for transports that need them.
    """
    notifier = get_notifier()
    if not notifier.configured:
        logger.info(f"Admin notification {event} not sent: no notifier configured")
        return None
    payload = {
        "recipient": settings.ADMIN_NOTIFY_RECIPIENT,
        "sender": settings.ADMIN_NOTIFY_SENDER,
        **payload,
    }
    return await notifier.notify(event, subject, text, payload)
