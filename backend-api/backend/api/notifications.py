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
    @property
    def configured(self) -> bool: ...

    async def notify(
        self, event: str, subject: str, text: str, payload: dict[str, Any]
    ) -> bool: ...


class WebhookNotifier:
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
    module_name, _, class_name = settings.ADMIN_NOTIFIER.partition(":")
    return getattr(import_module(module_name), class_name)()


async def notify_admins(
    event: str, subject: str, text: str, payload: dict[str, Any]
) -> bool | None:
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
