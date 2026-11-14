from contextlib import asynccontextmanager
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from api import models, signup
from tests.fixtures.base import TEST_BASE_URL, WEB_HEADERS, app
from utilities.config import settings

PASSWORD = "SignupPassword123!"  # noqa: S105
EXPIRED = "This link has expired or was used already. Sign up again."


class RecordingMailer:
    configured = True

    def __init__(self):
        self.calls: list[tuple] = []

    async def notify(self, event, subject, text, payload):
        self.calls.append((event, subject, text, payload))
        return True


class Unconfigured:
    configured = False

    async def notify(self, event, subject, text, payload):
        raise AssertionError("not configured")


@asynccontextmanager
async def _browser(headers: dict[str, str] | None = WEB_HEADERS):
    async with AsyncClient(transport=ASGITransport(app=app), base_url=TEST_BASE_URL, headers=headers or {}) as browser:
        yield browser


def _email() -> str:
    return f"signup-{uuid4().hex[:10]}@example.com"


async def _post(path: str, body: dict, headers=WEB_HEADERS):
    async with _browser(headers) as web:
        return await web.post(path, json=body)


async def _sign_in(email: str, password: str) -> int:
    response = await _post(
        "/app/login",
        {"email": email, "password": password, "source": "app", "version": "v1.0.0"},
    )
    return response.status_code


@pytest.fixture
def mailer(monkeypatch):
    recorder = RecordingMailer()
    monkeypatch.setattr(settings, "SIGNUP_ENABLED", True)
    monkeypatch.setattr(signup, "get_mailer", lambda: recorder)
    return recorder


@pytest.fixture
async def cleanup(db_session):
    emails: list[str] = []
    yield emails
    for email in emails:
        await db_session.execute(
            delete(models.Session).where(
                models.Session.user_uuid.in_(select(models.User.uuid).where(models.User.email == email))
            )
        )
        await db_session.execute(delete(models.UserInvite).where(models.UserInvite.email == email))
        await db_session.execute(delete(models.User).where(models.User.email == email))
    await db_session.commit()


def _token(mailer: RecordingMailer) -> str:
    (_, _, _, payload) = mailer.calls[-1]
    link = urlsplit(payload["link"])
    assert (link.scheme, link.netloc, link.path) == (
        "http",
        "localhost:3000",
        "/signup/confirm",
    )
    assert not link.query
    return link.fragment


class TestOffByDefault:
    def test_the_setting_is_off(self):
        assert type(settings).model_fields["SIGNUP_ENABLED"].default is False

    @pytest.mark.asyncio
    async def test_both_routes_answer_404(self, client, monkeypatch):
        monkeypatch.setattr(settings, "SIGNUP_ENABLED", False)
        assert (await _post("/app/signup", {"email": _email()})).status_code == 404
        confirm = {"token": "x", "new_password": PASSWORD}
        assert (await _post("/app/signup/confirm", confirm)).status_code == 404


class TestTheFlow:
    @pytest.mark.asyncio
    async def test_the_link_creates_a_confirmed_account_with_the_chosen_password(self, client, mailer, cleanup):
        email = _email()
        cleanup.append(email)
        response = await _post("/app/signup", {"email": email, "first_name": "Ada", "last_name": "Lovelace"})
        assert response.status_code == 202, response.text
        (event, _, text, payload) = mailer.calls[0]
        assert event == "signup.confirmation"
        assert payload["recipient"] == email
        assert payload["link"] in text
        assert await _sign_in(email, PASSWORD) == 401

        token = _token(mailer)
        confirm = await _post("/app/signup/confirm", {"token": token, "new_password": PASSWORD})
        assert confirm.status_code == 200, confirm.text
        assert await _sign_in(email, PASSWORD) == 200

    @pytest.mark.asyncio
    async def test_a_link_works_once(self, client, mailer, cleanup):
        email = _email()
        cleanup.append(email)
        await _post("/app/signup", {"email": email})
        token = _token(mailer)
        body = {"token": token, "new_password": PASSWORD}
        assert (await _post("/app/signup/confirm", body)).status_code == 200
        again = await _post("/app/signup/confirm", body)
        assert again.status_code == 400
        assert again.json()["detail"] == EXPIRED

    @pytest.mark.asyncio
    async def test_an_unknown_token_is_refused(self, client, mailer):
        response = await _post("/app/signup/confirm", {"token": "nope", "new_password": PASSWORD})
        assert response.status_code == 400
        assert response.json()["detail"] == EXPIRED

    @pytest.mark.asyncio
    async def test_an_existing_address_gets_the_same_answer_and_no_mail(self, client, mailer, organization):
        user = await organization.add_user(password=PASSWORD)
        response = await _post("/app/signup", {"email": user.email})
        assert response.status_code == 202
        assert response.json() == {"success": True}
        assert mailer.calls == []


class TestRefusals:
    @pytest.mark.asyncio
    async def test_an_unconfigured_mailer_answers_503(self, client, mailer, monkeypatch):
        monkeypatch.setattr(signup, "get_mailer", Unconfigured)
        response = await _post("/app/signup", {"email": _email()})
        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_disabled_registration_answers_403(self, client, mailer, monkeypatch):
        monkeypatch.setattr(settings, "DISABLE_REGISTRATION", True)
        response = await _post("/app/signup", {"email": _email()})
        assert response.status_code == 403
        assert mailer.calls == []

    @pytest.mark.asyncio
    async def test_a_missing_mapping_answers_503(self, client, mailer, monkeypatch):
        monkeypatch.setattr(settings, "DEFAULT_USER_MAPPING", None)
        response = await _post("/app/signup", {"email": _email()})
        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_the_web_header_is_required(self, client, mailer):
        response = await _post("/app/signup", {"email": _email()}, headers=None)
        assert response.status_code in {400, 401, 403}
        assert mailer.calls == []

    @pytest.mark.asyncio
    async def test_a_failing_mailer_does_not_change_the_answer(self, client, mailer, monkeypatch):
        async def boom(*args, **kwargs):
            raise RuntimeError("smtp down")

        monkeypatch.setattr(mailer, "notify", boom)
        response = await _post("/app/signup", {"email": _email()})
        assert response.status_code == 202


class TestPerAddressLimit:
    @pytest.mark.asyncio
    async def test_a_fourth_link_in_an_hour_is_not_sent(self, client, mailer):
        email = _email()
        for _ in range(signup.MAILS_PER_ADDRESS + 1):
            response = await _post("/app/signup", {"email": email})
            assert response.status_code == 202
            assert response.json() == {"success": True}
        assert len(mailer.calls) == signup.MAILS_PER_ADDRESS

    @pytest.mark.asyncio
    async def test_plus_addressing_does_not_get_around_it(self, client, mailer):
        name = f"signup-{uuid4().hex[:10]}"
        for tag in range(signup.MAILS_PER_ADDRESS + 2):
            await _post("/app/signup", {"email": f"{name}+{tag}@example.com"})
        assert len(mailer.calls) == signup.MAILS_PER_ADDRESS

    @pytest.mark.asyncio
    async def test_another_address_is_not_affected(self, client, mailer):
        for _ in range(signup.MAILS_PER_ADDRESS + 1):
            await _post("/app/signup", {"email": _email()})
        assert len(mailer.calls) == signup.MAILS_PER_ADDRESS + 1


class TestTheHook:
    def test_a_deployment_names_its_own_mailer(self, monkeypatch):
        monkeypatch.setattr(settings, "SIGNUP_MAILER", "tests.test_signup:RecordingMailer")
        signup.get_mailer.cache_clear()
        try:
            assert isinstance(signup.get_mailer(), RecordingMailer)
        finally:
            signup.get_mailer.cache_clear()

    def test_the_default_mailer_needs_a_url(self, monkeypatch):
        monkeypatch.setattr(settings, "SIGNUP_WEBHOOK_URL", None)
        assert signup.WebhookMailer().configured is False
        monkeypatch.setattr(settings, "SIGNUP_WEBHOOK_URL", "https://hooks.example.com/s")
        assert signup.WebhookMailer().configured is True
