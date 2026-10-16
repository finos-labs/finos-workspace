"""General functions to help throughout the repo"""

import asyncio
import contextlib
import hmac
import warnings
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

import pyotp
from fastapi import HTTPException
from httpx import AsyncClient
from loguru import logger
from rq.timeouts import JobTimeoutException
from sqlalchemy import case, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import models, worker_tasks
from api.database import AsyncWriteSessionLocal
from api.models import DashboardItem, Entity, EntityType, PermissionsEntityMap, User
from utilities import rq_results
from utilities.config import settings

HTTPX_CLIENT: AsyncClient | None = None


async def add_log_task(request: str, error: str, status_code: int, method: str):
    # Silence the pytest mock warning
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        async with AsyncWriteSessionLocal.session() as db:
            query = insert(models.Log).values(
                request=request, error=error, status_code=status_code, method=method
            )
            await db.execute(query)
            await db.commit()


def add_log(request: str, error: str, status_code: int, method: str):
    # Ensures exceptions aren't raised while called inside fastapi exception handlers
    # This is to prevent SQL details from being leaked to the client
    with contextlib.suppress(Exception):
        asyncio.ensure_future(add_log_task(request, error, status_code, method))


def handle_duplicate_pk(exc: IntegrityError):
    err_message = str(exc.orig)
    # SQLite reports duplicates as "UNIQUE constraint failed: <table>.<column>"
    if "UNIQUE constraint failed" in err_message:
        return
    duplicate_entry = "Duplicate entry" in err_message or "duplicate key" in err_message
    primary = "PRIMARY" in err_message or "unique constraint" in err_message

    if not duplicate_entry or not primary:
        raise HTTPException(400, detail="Unknown database error occurred") from exc


async def get_user_usage(user: User):
    """Update user usage"""

    return await worker_tasks.update_user_usage_cache(user.uuid)


def refresh_usage_cache(user_uuid: UUID) -> None:
    try:
        rq_results.rq_que.enqueue(
            worker_tasks.user_usage_cache_task,
            user_uuid,
            job_timeout=settings.RQ_TIMEOUT,
        )

    except JobTimeoutException:
        logger.error(f"Update user usage job timed out for user: {user_uuid}")


def handle_add_login(
    user_uuid: UUID,
    source: None | Literal["app", "oauth-app", "excel", "cli", "admin"],
) -> None:
    try:
        rq_results.rq_que.enqueue(
            worker_tasks.login_information,
            user_uuid,
            source,
            job_timeout=settings.RQ_TIMEOUT,
        )

    except JobTimeoutException:
        logger.error(f"Login information job timed out for user: {user_uuid}")


async def check_first_login(
    db: AsyncSession,
    user_uuid: UUID,
    sources: list[Literal["app", "oauth-app", "excel"]] | None = None,
) -> bool:
    """Check if the user is logging in for the first time"""
    query = (
        select(func.count(models.Login.uuid))
        .where(
            models.Login.user_uuid == user_uuid,
            models.Login.source.in_(sources) if sources else True,
        )
        .limit(5)
    )

    result = (await db.execute(query)).scalar_one_or_none()

    return result is None or result == 0


def handle_share_files(
    owner_uuid: UUID,
    dashboard_uuid: UUID | None = None,
    user_app_uuid: UUID | None = None,
) -> None:
    try:
        rq_results.rq_que.enqueue(
            worker_tasks.update_share_files,
            str(owner_uuid),
            str(dashboard_uuid) if dashboard_uuid else None,
            str(user_app_uuid) if user_app_uuid else None,
            job_timeout=settings.RQ_TIMEOUT,
        )

    except JobTimeoutException:
        logger.error(f"Update shared files job timed out for user: {owner_uuid}")


async def verify_totp(
    db: AsyncSession, user_uuid: UUID, secret: str | None, code: int | None
) -> bool:
    """Whether ``code`` is the user's current authenticator code.

    A code of the time step before or after the current one is accepted too, for clock
    drift. The step of an accepted code is recorded, and a code of that step or an
    earlier one is refused from then on, so a code works once.
    """
    if not secret or code is None:
        return False
    totp = pyotp.TOTP(secret)
    candidate = f"{code:0{totp.digits}d}"
    now = datetime.now(UTC)
    if not totp.verify(candidate, for_time=now, valid_window=1):
        return False
    current = totp.timecode(now)
    step = next(
        step
        for step in (current + 1, current, current - 1)
        if hmac.compare_digest(totp.generate_otp(step), candidate)
    )
    # One statement checks and records the step, so two requests cannot both use a code
    result = await db.execute(
        update(User)
        .where(
            User.uuid == user_uuid,
            or_(User.totp_last_step.is_(None), User.totp_last_step < step),
        )
        .values(totp_last_step=step)
    )
    await db.commit()
    return result.rowcount == 1


def get_app_user_query(email: str):
    query = (
        select(
            User.email,
            User.uuid,
            User.username,
            User.confirmed,
            User.password,
            User.latest_version,
            User.permissions_uuid,
            User.temporary_password,
            User.totp_secret,
            User.totp_active,
            User.two_factor_auth,
            User.is_superuser,
            User.can_submit_marketplace,
            Entity.uuid.label("entity_uuid"),
            Entity.require_authenticator,
            Entity.name,
            PermissionsEntityMap.name.label("role"),
        )
        .join(
            PermissionsEntityMap,
            User.permissions_uuid == PermissionsEntityMap.uuid,
            isouter=True,
        )
        .join(Entity, PermissionsEntityMap.entity_uuid == Entity.uuid, isouter=True)
        .where(User.deleted.is_(False))
    )
    if "@" in email:
        return query.where(User.email == email).limit(1)
    return query.where(User.username == email).limit(1)


DEFAULT_ENTITY_TYPE_CODE = "DEF"


async def get_or_create_entity_type(db: AsyncSession, code: str) -> UUID:
    select_query = select(EntityType.uuid).where(
        EntityType.code == code, EntityType.active.is_(True)
    )
    response = (await db.execute(select_query)).first()
    if response:
        return response.uuid
    create_query = insert(EntityType).values(
        code=code, active=True, permission_hierarchy=0, entity_type="Default"
    )
    return (await db.execute(create_query)).inserted_primary_key[0]


async def get_or_create_entity(db: AsyncSession, entity_type: UUID, name: str) -> UUID:
    select_query = select(Entity.uuid).where(
        Entity.name == name, Entity.entity_type_uuid == entity_type
    )
    response = (await db.execute(select_query)).first()
    if response:
        return response.uuid
    create_query = insert(Entity).values(
        name=name,
        entity_type_uuid=entity_type,
        email=None,
        company_type=None,
        organization_size=None,
        aum=None,
        country=None,
    )
    return (await db.execute(create_query)).inserted_primary_key[0]


async def create_developer_mapping():
    async with AsyncWriteSessionLocal.session() as db:
        try:
            # Check if entity already exists
            check_query = (
                select(Entity.uuid).where(Entity.name == "Developer").limit(1)
            )
            response = (await db.execute(check_query)).scalar_one_or_none()
            if response:
                return

            entity_type_uuid = await get_or_create_entity_type(
                db, DEFAULT_ENTITY_TYPE_CODE
            )
            entity_uuid = await get_or_create_entity(
                db, entity_type_uuid, "Developer"
            )
            create_mapping_q = insert(PermissionsEntityMap).values(
                uuid=settings.DEVELOPER_MAPPING,
                entity_uuid=entity_uuid,
                name=models.DEVELOPER_TYPE,
            )
            await db.execute(create_mapping_q)
            await db.execute(
                insert(PermissionsEntityMap),
                [
                    {"entity_uuid": entity_uuid, "name": user_type}
                    for user_type in (models.ADMIN_TYPE, models.USER_TYPE)
                ],
            )
            await db.commit()

        except IntegrityError as e:
            handle_duplicate_pk(e)
            await db.rollback()
        except Exception as e:
            if not settings.is_onprem():
                logger.exception(e)
            await db.rollback()


async def get_managed_users(db: AsyncSession, admin_result: UUID):
    latest_login_subquery = (
        select(
            models.Login.user_uuid,
            func.max(models.Login.created_date).label("last_login"),
        )
        .group_by(models.Login.user_uuid)
        .alias()
    )
    # Get active users and users who are invited with a new account
    query = (
        select(
            User.uuid,
            User.first_name,
            User.last_name,
            User.email,
            PermissionsEntityMap.name.label("role"),
            latest_login_subquery.c.last_login,
            User.permissions_uuid,
            func.max(DashboardItem.updated_date).label("last_active"),
            case((User.confirmed.is_(True), "active"), else_="pending").label("status"),
        )
        .join(PermissionsEntityMap, User.permissions_uuid == PermissionsEntityMap.uuid)
        .join(
            latest_login_subquery,
            User.uuid == latest_login_subquery.c.user_uuid,
            isouter=True,
        )
        .join(DashboardItem, User.uuid == DashboardItem.owner_uuid, isouter=True)
        .where(
            PermissionsEntityMap.entity_uuid == admin_result, User.deleted.is_(False)
        )
        .group_by(
            User.uuid,
            User.first_name,
            User.last_name,
            User.email,
            PermissionsEntityMap.name,
            latest_login_subquery.c.last_login,
            User.permissions_uuid,
            User.confirmed,
        )
    )
    return (await db.execute(query)).all()


async def get_invite_users(db: AsyncSession, admin_result: UUID):
    query = (
        select(
            models.UserInvite.email,
            PermissionsEntityMap.name.label("role"),
            models.UserInvite.data,
            models.UserInvite.uuid,
        )
        .select_from(models.UserInvite)
        .join(
            PermissionsEntityMap,
            models.UserInvite.permissions_uuid == PermissionsEntityMap.uuid,
        )
        .where(
            PermissionsEntityMap.entity_uuid == admin_result,
            models.UserInvite.used.is_(False),
        )
    )
    return (await db.execute(query)).all()


def get_app_session_expiration(remember: bool) -> timedelta:
    return timedelta(30 if remember else 7)


def get_httpx_client() -> AsyncClient:
    global HTTPX_CLIENT  # noqa: PLW0603
    if not HTTPX_CLIENT:
        HTTPX_CLIENT = AsyncClient()
    return HTTPX_CLIENT


async def stream_response_httpx(url: str) -> AsyncGenerator[bytes, None]:
    async with get_httpx_client().stream("GET", url) as response:
        if response.is_error:
            raise HTTPException(response.status_code, detail=response.text)
        async for chunk in response.aiter_raw():
            yield chunk


async def get_file_response(url: str) -> bytes:
    async with get_httpx_client().stream("GET", url) as response:
        if response.is_error:
            raise HTTPException(response.status_code, detail=response.text)
        return await response.aread()


async def test_url(url: str) -> bool:
    async with get_httpx_client().stream("HEAD", url) as response:
        return response.is_success
