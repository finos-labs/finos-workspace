import json
import secrets
from datetime import timedelta
from functools import cache
from importlib import import_module

from loguru import logger

from utilities.config import settings

from . import base, crypto
from .auth_helpers import app_redis, app_redis_key
from .notifications import AdminNotifier, WebhookNotifier

SIGNUP_LIFETIME = timedelta(hours=24)
SIGNUP_EVENT = "signup.confirmation"
MAILS_PER_ADDRESS = 3
MAIL_WINDOW = timedelta(hours=1)


class WebhookMailer(WebhookNotifier):
    def __init__(self):
        super().__init__(settings.SIGNUP_WEBHOOK_URL or "", settings.SIGNUP_WEBHOOK_SECRET or "")


@cache
def get_mailer() -> AdminNotifier:
    module_name, _, class_name = settings.SIGNUP_MAILER.partition(":")
    return getattr(import_module(module_name), class_name)()


def _key(token: str) -> str:
    return app_redis_key(f"signup:{crypto.hash_token(token)}")


async def allow_mail(email: str) -> bool:
    address = crypto.hash_token(base.clean_email(email).lower())
    async with app_redis() as redis:
        key = app_redis_key(f"signup_mails:{address}")
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, int(MAIL_WINDOW.total_seconds()))
    return count <= MAILS_PER_ADDRESS


async def issue_signup(email: str, first_name: str | None, last_name: str | None) -> str:
    token = secrets.token_urlsafe(32)
    value = json.dumps({"email": email, "first_name": first_name, "last_name": last_name})
    async with app_redis() as redis:
        await redis.set(_key(token), value, ex=int(SIGNUP_LIFETIME.total_seconds()))
    return token


async def take_signup(token: str) -> dict[str, str | None] | None:
    async with app_redis() as redis:
        value = await redis.getdel(_key(token))
    if value is None:
        return None
    return json.loads(value)


async def send_confirmation(email: str, link: str) -> bool:
    mailer = get_mailer()
    text = f"Open this link to finish creating your account: {link}"
    try:
        return await mailer.notify(
            SIGNUP_EVENT,
            "Confirm your email address",
            text,
            {"recipient": email, "link": link},
        )
    except Exception:
        logger.exception("Signup confirmation was not sent")
        return False
