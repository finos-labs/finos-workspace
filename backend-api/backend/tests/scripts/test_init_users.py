"""The bootstrap that creates the first entity and admin of a fresh installation.

The image runs it on every start. When it fails, the app comes up with no account to
sign in with, and nothing else in the suite notices. The administrator's password is made
up when the account is created and shown once; no file holds it, and a later run never
changes it.
"""

import re
import secrets
from datetime import timedelta

import pytest
from sqlalchemy import delete, insert, select, update

from api import base, models
from scripts import init_users
from scripts.init_users import Config, SetupConfig
from tests.fixtures.base import _set_fk_checks

ENTITY_NAME = "Initial Organization"
ADMIN_EMAIL = "bootstrap-admin@example.com"
OTHER_EMAIL = "bootstrap-member@example.com"
CREATED = re.compile(
    rf"^The administrator {re.escape(ADMIN_EMAIL)} was created\. "
    r"Password, shown only this once: (\S+)$",
    re.MULTILINE,
)


def _config() -> Config:
    return Config(
        entity={
            "name": ENTITY_NAME,
            "aum": 0,
            "company_type": "CORPORATION",
            "organization_size": "SMALL",
            "country": "DOM",
        },
        admins=[
            {
                "email": ADMIN_EMAIL,
                "first_name": "Bootstrap",
                "last_name": "Admin",
            }
        ],
        users=[],
    )


@pytest.fixture
async def bootstrap_cleanup(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(init_users, "USER_CREATE_JSON_PATH", tmp_path / "user_create.json")
    yield

    await _set_fk_checks(db_session, enabled=False)
    entity_uuid = (
        await db_session.execute(
            select(models.Entity.uuid).where(models.Entity.name == ENTITY_NAME)
        )
    ).scalar_one_or_none()
    type_code = ENTITY_NAME[:3].upper()
    users = select(models.User.uuid).where(models.User.email.in_([ADMIN_EMAIL, OTHER_EMAIL]))
    await db_session.execute(delete(models.Session).where(models.Session.user_uuid.in_(users)))
    await db_session.execute(
        delete(models.User).where(models.User.email.in_([ADMIN_EMAIL, OTHER_EMAIL]))
    )
    if entity_uuid:
        await db_session.execute(
            delete(models.PermissionsEntityMap).where(
                models.PermissionsEntityMap.entity_uuid == entity_uuid
            )
        )
        await db_session.execute(delete(models.Entity).where(models.Entity.uuid == entity_uuid))
    await db_session.execute(
        delete(models.EntityType).where(models.EntityType.code == type_code)
    )
    await _set_fk_checks(db_session, enabled=True)
    await db_session.commit()


async def _admin(db_session) -> models.User:
    admin = (
        await db_session.execute(
            select(models.User)
            .where(models.User.email == ADMIN_EMAIL)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return admin


@pytest.mark.asyncio
async def test_bootstrap_creates_the_entity_and_a_working_admin(
    db_session, bootstrap_cleanup, capsys
):
    await SetupConfig(_config(), db_session).run()
    shown = CREATED.findall(capsys.readouterr().out)

    entity = (
        await db_session.execute(
            select(models.Entity).where(models.Entity.name == ENTITY_NAME)
        )
    ).scalar_one()

    maps = (
        (
            await db_session.execute(
                select(models.PermissionsEntityMap.name).where(
                    models.PermissionsEntityMap.entity_uuid == entity.uuid
                )
            )
        )
        .scalars()
        .all()
    )
    assert set(maps) == {"Admin", "Developer", "User"}

    admin = await _admin(db_session)
    assert admin.is_superuser
    # The password is shown once, and it is the one that signs in
    assert len(shown) == 1
    assert base.verify_password(shown[0], admin.password)
    assert not admin.temporary_password


def test_a_config_names_no_password():
    assert "password" not in init_users.AdminUser.model_fields
    assert "password" not in _config().model_dump_json()


@pytest.mark.asyncio
async def test_a_later_run_shows_no_password_and_keeps_the_one_the_admin_chose(
    db_session, bootstrap_cleanup, capsys
):
    await SetupConfig(_config(), db_session).run()
    capsys.readouterr()
    chosen = "Ch0sen!" + secrets.token_urlsafe(8)
    await db_session.execute(
        update(models.User).where(models.User.email == ADMIN_EMAIL).values(password=chosen)
    )
    await db_session.commit()

    await SetupConfig(_config(), db_session).run()

    assert "Password" not in capsys.readouterr().out
    assert base.verify_password(chosen, (await _admin(db_session)).password)


@pytest.mark.asyncio
async def test_bootstrap_can_run_again(db_session, bootstrap_cleanup):
    await SetupConfig(_config(), db_session).run()
    await SetupConfig(_config(), db_session).run()

    entities = (
        (
            await db_session.execute(
                select(models.Entity.uuid).where(models.Entity.name == ENTITY_NAME)
            )
        )
        .scalars()
        .all()
    )
    assert len(entities) == 1


async def _sign_in(db_session, user_uuid) -> None:
    await db_session.execute(
        insert(models.Session).values(
            token_hash=secrets.token_hex(32),
            user_uuid=user_uuid,
            expiration_date=base.get_now() + timedelta(days=1),
            app_session=True,
            source="app",
        )
    )
    await db_session.commit()


async def _sessions(db_session, user_uuid) -> int:
    rows = await db_session.execute(
        select(models.Session.uuid).where(models.Session.user_uuid == user_uuid)
    )
    return len(rows.all())


@pytest.mark.asyncio
async def test_a_new_password_is_one_time_and_ends_every_session(
    db_session, bootstrap_cleanup, capsys
):
    await SetupConfig(_config(), db_session).run()
    first = CREATED.findall(capsys.readouterr().out)[0]
    admin = await _admin(db_session)
    await _sign_in(db_session, admin.uuid)

    password = await init_users.new_password(db_session, ADMIN_EMAIL)

    admin = await _admin(db_session)
    assert password and password != first
    assert base.verify_password(password, admin.password)
    assert not base.verify_password(first, admin.password)
    # The web app asks for a password of the admin's own at the next sign-in
    assert admin.temporary_password
    assert await _sessions(db_session, admin.uuid) == 0


@pytest.mark.asyncio
async def test_a_new_password_is_only_for_an_administrator(db_session, bootstrap_cleanup):
    await SetupConfig(_config(), db_session).run()
    admin = await _admin(db_session)
    await db_session.execute(
        insert(models.User).values(
            email=OTHER_EMAIL,
            clean_email=base.clean_email(OTHER_EMAIL),
            confirmed=1,
            is_superuser=0,
            permissions_uuid=admin.permissions_uuid,
            password="Memb3r!" + secrets.token_urlsafe(8),
        )
    )
    await db_session.commit()

    assert await init_users.new_password(db_session, OTHER_EMAIL) is None
    assert await init_users.new_password(db_session, "nobody@example.com") is None


@pytest.mark.asyncio
async def test_the_new_password_command_prints_it_once(
    db_session, bootstrap_cleanup, capsys, monkeypatch
):
    await SetupConfig(_config(), db_session).run()
    capsys.readouterr()

    async def the_test_database():
        yield db_session

    monkeypatch.setattr(init_users, "aget_write_db", the_test_database)

    assert await init_users.show_new_password(ADMIN_EMAIL) == 0
    out = capsys.readouterr().out
    password = re.search(rf"^New one-time password of {re.escape(ADMIN_EMAIL)}: (\S+)$", out, re.M)
    assert password
    assert base.verify_password(password.group(1), (await _admin(db_session)).password)

    assert await init_users.show_new_password("nobody@example.com") == 1
    assert "nobody@example.com is not an administrator" in capsys.readouterr().err
