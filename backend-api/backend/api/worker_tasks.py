"""Worker tasks for the API."""

import asyncio
import warnings
from datetime import datetime, timedelta  # type: ignore
from typing import Literal
from uuid import UUID

from loguru import logger

from api.schemas import EntitlementUsageGet
from api.storage import FileStorage
from routers.app.helpers import get_entitlement
from utilities import workers_queue
from utilities.decorators import next_schedule_dt, repeat_every

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
from sqlalchemy import delete, func, insert, or_, select, update

from api import base, crud
from api.database import AsyncReadSessionLocal, AsyncWriteSessionLocal
from api.models import (
    DashboardSave,
    EntitlementUsage,
    Entity,
    EntityEntitlement,
    Login,
    StoredFile,
)
from routers import app_helpers
from utilities.config import settings


async def login_information(
    user_uuid: UUID,
    ip_address: None | str,
    source: None | Literal["sdk", "app", "oauth-app", "excel"],
) -> None:
    """Records a login"""
    async with AsyncWriteSessionLocal.session() as db:
        query = insert(Login).values(
            ip_address=ip_address, source=source or "app", user_uuid=user_uuid
        )
        await db.execute(query)
        await db.commit()


async def delete_old_saves() -> bool:
    """Delete old dashboard saves if they are older than two days old and
    if the user has more than 10 saves.
    """

    async with AsyncWriteSessionLocal.session() as db:
        to_delete = await crud.get_dashboard_saves_to_delete(db)
        delete_date = base.get_now() - timedelta(days=2)
        delete_query = delete(DashboardSave).where(
            DashboardSave.uuid.in_(to_delete), DashboardSave.created_date < delete_date
        )
        await db.execute(delete_query)
        await db.commit()

    return True


async def delete_unconfirmed_files(delete_delay: int = 7) -> bool:
    """Deletes unconfirmed files that are older than a certain number of days"""

    delete_end = base.get_now() - timedelta(days=delete_delay)
    delete_start = delete_end - timedelta(days=7)

    async with AsyncWriteSessionLocal.session() as db:
        select_query = select(StoredFile).where(
            StoredFile.file_widget_uuid.is_(None),
            StoredFile.created_date >= delete_start,
            StoredFile.created_date < delete_end,
            StoredFile.is_global.is_(False),
        )

        to_delete = (await db.execute(select_query)).scalars().all()

        for file in to_delete:
            if await FileStorage.delete_file(file.bucket, file.s3_file_name):
                await db.delete(file)

        await db.commit()

    return True


async def update_share_files(
    owner_uuid: str, dashboard_uuid: str | None = None, user_app_uuid: str | None = None
) -> bool:
    """Updates the shared files for a dashboard or user app"""
    try:
        dashboard_uuid = UUID(dashboard_uuid) if dashboard_uuid else None
        user_app_uuid = UUID(user_app_uuid) if user_app_uuid else None
        owner_uuid = UUID(owner_uuid)
    except ValueError:
        return False

    async with AsyncWriteSessionLocal.session() as db:
        await crud.update_shared_files(db, owner_uuid, dashboard_uuid, user_app_uuid)

    return True


@repeat_every(seconds=timedelta(hours=10), wait_first=False)
async def delete_old_saves_task():
    """Task to delete old dashboard saves"""
    return await workers_queue.worker_queue_at(
        delete_old_saves,
        next_schedule_dt(base.get_midnight(), add_days=3),
        job_timeout=1800,
    )


@repeat_every(seconds=timedelta(hours=10), wait_first=False)
async def delete_unconfirmed_files_task():
    """Task to delete unconfirmed files"""
    return await workers_queue.worker_queue_at(
        delete_unconfirmed_files,
        next_schedule_dt(base.get_midnight(), add_days=2),
        job_timeout=1800,
    )


@repeat_every(seconds=timedelta(minutes=2), wait_first=True, max_repetitions=1)
async def delete_unconfirmed_files_no_delay_task():
    """Task to delete unconfirmed files"""
    clear_date = settings.CLEAR_UNCONFIRMED_FILES_DATE

    for delete_delay in reversed(range(0, 30)):
        await workers_queue.worker_queue(
            delete_unconfirmed_files,
            f"delete_unconfirmed_files_{clear_date}_{delete_delay}",
            delete_delay=delete_delay,
            result_ttl=-1,
            job_timeout=500,
        )


async def get_usage_tasks(uuid: UUID, usage_type: Literal["file", "copilot", "limits"]):
    """Get usage tasks for a user"""
    async with AsyncReadSessionLocal.session() as db:
        if usage_type == "limits":
            return await get_entitlement(db, uuid)

        if usage_type == "file":
            file_sum_query = select(func.sum(StoredFile.size)).where(
                StoredFile.creater_uuid == uuid
            )
            total_file_bytes = (await db.execute(file_sum_query)).scalar_one_or_none()
            return total_file_bytes

        if usage_type == "copilot":
            usage_query = await db.execute(
                select(
                    EntitlementUsage.number_copilot_calls_day_count,
                    EntitlementUsage.number_copilot_tokens_day_count,
                )
                .where(EntitlementUsage.user_uuid == uuid)
                .limit(1)
            )
            counts = usage_query.first()
            return tuple(counts) if counts else (None, None)

    return None


async def update_user_usage_cache(user_uuid: UUID, reset_copilot_calls: bool = False):
    tasks = [
        asyncio.create_task(get_usage_tasks(user_uuid, "limits")),
        asyncio.create_task(get_usage_tasks(user_uuid, "file")),
        asyncio.create_task(get_usage_tasks(user_uuid, "copilot")),
    ]

    limits, total_file_bytes, (copilot_calls_day_count, copilot_tokens_day_count) = (
        await asyncio.gather(*tasks)
    )

    if not limits:
        return None

    total_file_upload_size_gb_count = (
        (total_file_bytes / (1024**3)) if total_file_bytes else 0
    )

    try:
        cache_data = {
            "copilot_calls_limit": limits.number_copilot_calls_day,
            "copilot_tokens_limit": limits.number_copilot_tokens_day,
            "file_upload_size_limit": limits.total_file_upload_size_gb,
            "number_copilot_calls_day_count": (
                0 if reset_copilot_calls else (copilot_calls_day_count or 0)
            ),
            "number_copilot_tokens_day_count": (
                0 if reset_copilot_calls else (copilot_tokens_day_count or 0)
            ),
            "total_file_upload_size_gb_count": total_file_upload_size_gb_count or 0,
        }

        settings.redis_cache(f"usage:{user_uuid}", cache_data, update=True)
        return EntitlementUsageGet(**cache_data)
    except Exception as e:
        logger.exception(e)

    return None


async def entitlement_usage(reset_copilot_calls: bool = False):
    """Entitlement usage"""
    logger.info("Starting entitlement_usage task")
    async with AsyncWriteSessionLocal.session() as db:
        query = select(EntitlementUsage.user_uuid).where(
            or_(
                EntitlementUsage.number_copilot_calls_day_count != 0,
                EntitlementUsage.number_copilot_tokens_day_count != 0,
            )
        )
        results = (await db.execute(query)).scalars().all()

        for user_uuid in results:

            if cache_data := settings.redis_cache(f"usage:{user_uuid}"):
                cache_data = EntitlementUsageGet.model_validate(cache_data)

            if (
                updated_data := await update_user_usage_cache(
                    user_uuid, reset_copilot_calls
                )
            ) is None:
                continue

            if cache_data and (
                cache_data.number_copilot_calls_day_count
                == updated_data.number_copilot_calls_day_count
                and cache_data.number_copilot_tokens_day_count
                == updated_data.number_copilot_tokens_day_count
                and cache_data.total_file_upload_size_gb_count
                == updated_data.total_file_upload_size_gb_count
            ):
                continue

            update_query = (
                update(EntitlementUsage)
                .where(EntitlementUsage.user_uuid == user_uuid)
                .values(
                    number_copilot_calls_day_count=updated_data.number_copilot_calls_day_count
                    or 0,
                    number_copilot_tokens_day_count=updated_data.number_copilot_tokens_day_count
                    or 0,
                    total_file_upload_size_gb_count=updated_data.total_file_upload_size_gb_count
                    or 0,
                )
            )

            try:
                await db.execute(update_query)
            except Exception as e:
                logger.exception(e)
                await db.rollback()

        await db.commit()

    logger.info("Finished entitlement_usage task")
    return True


@repeat_every(seconds=timedelta(minutes=5), wait_first=False)
async def entitlement_usage_task():
    """Entitlement usage"""
    return await workers_queue.worker_queue(
        entitlement_usage,
        "entitlement_usage",
        result_ttl=base.get_result_ttl(timedelta(minutes=4)),
        job_timeout=1800,
    )


async def add_entity_entitlements():
    """Add entity entitlements for entities without an entitlement"""

    async with AsyncWriteSessionLocal.session() as db:
        try:
            query = (
                select(Entity.uuid)
                .select_from(Entity)
                .outerjoin(
                    EntityEntitlement, Entity.uuid == EntityEntitlement.entity_uuid
                )
                .where(EntityEntitlement.uuid.is_(None))
            )
            entities_wo_entitlement = (await db.execute(query)).scalars().all()
            for entity_uuid in entities_wo_entitlement:
                await app_helpers.insert_entity_entitlement(db, entity_uuid, "full")
        except Exception as e:
            logger.exception(e)
            await db.rollback()

    return True


# Not repeated: entities created by `scripts/init_users.py` get their entitlement here
@repeat_every(seconds=10, wait_first=True, max_repetitions=1)
async def add_entity_entitlements_task():
    """Task to add entity entitlements"""
    # setting result_ttl to -1 to keep the return value in redis indefinitely (prevents the task from being re-run)
    return await workers_queue.worker_queue(
        add_entity_entitlements, "add_entity_entitlements", sleep=10, result_ttl=-1
    )


async def user_usage_cache_task(user_uuid: UUID):
    """Update user usage"""
    return await update_user_usage_cache(user_uuid)


async def reset_copilot_calls():
    return await entitlement_usage(reset_copilot_calls=True)


@repeat_every(seconds=timedelta(hours=2), wait_first=False)
async def reset_copilot_calls_task():
    """Task to reset copilot calls"""
    return await workers_queue.worker_queue_at(
        reset_copilot_calls,
        next_schedule_dt(base.get_midnight()),
        job_timeout=1800,
    )


async def start_background_tasks():
    """Start all background tasks"""

    await reset_copilot_calls_task()
    await entitlement_usage_task()
    await delete_old_saves_task()
    await delete_unconfirmed_files_task()
    await add_entity_entitlements_task()

    clear_datetime = datetime.strptime(
        settings.CLEAR_UNCONFIRMED_FILES_DATE, "%Y-%m-%d"
    )

    # Clear unconfirmed files if the current day is the same
    # as the clear date
    if base.get_now().day == clear_datetime.day:
        await delete_unconfirmed_files_no_delay_task()

    return True
