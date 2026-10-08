"""The bootstrap that creates the first entity and admin of a fresh installation.

The image runs it on every start. When it fails, the app comes up with no account to
sign in with, and nothing else in the suite notices.
"""

import pytest
from sqlalchemy import delete, select

from api import base, models
from scripts import init_users
from scripts.init_users import Config, SetupConfig
from tests.fixtures.base import _set_fk_checks

ENTITY_NAME = "Initial Organization"
ADMIN_EMAIL = "bootstrap-admin@example.com"
ADMIN_PASSWORD = "Str0ng!Passw0rd"  # noqa: S105


def _config() -> Config:
    return Config(
        entity={
            "name": ENTITY_NAME,
            "seats": 10,
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
                "password": ADMIN_PASSWORD,
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
    await db_session.execute(delete(models.User).where(models.User.email == ADMIN_EMAIL))
    if entity_uuid:
        await db_session.execute(
            delete(models.EntityEntitlement).where(
                models.EntityEntitlement.entity_uuid == entity_uuid
            )
        )
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


@pytest.mark.asyncio
async def test_bootstrap_creates_the_entity_and_a_working_admin(
    db_session, bootstrap_cleanup
):
    await SetupConfig(_config(), db_session).run()

    entity = (
        await db_session.execute(
            select(models.Entity).where(models.Entity.name == ENTITY_NAME)
        )
    ).scalar_one()
    assert entity.seats == 10

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
    assert set(maps) == {"Admin", "User"}

    admin = (
        await db_session.execute(
            select(models.User).where(models.User.email == ADMIN_EMAIL)
        )
    ).scalar_one()
    assert admin.is_superuser
    assert base.verify_password(ADMIN_PASSWORD, admin.password)

    entitlements = (
        (
            await db_session.execute(
                select(models.EntityEntitlement.uuid).where(
                    models.EntityEntitlement.entity_uuid == entity.uuid
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(entitlements) == 1


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
