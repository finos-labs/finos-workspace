import asyncio
import warnings
from datetime import datetime, timedelta  # type: ignore
from typing import Literal
from uuid import UUID

from loguru import logger

from api.schemas import UsageGet
from api.storage import FileStorage
from routers.app.helpers import get_user_limits
from utilities import workers_queue
from utilities.decorators import next_schedule_dt, repeat_every

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
from sqlalchemy import delete, func, insert, or_, select, update

from api import base, crud, provider_tokens
from api.database import AsyncReadSessionLocal, AsyncWriteSessionLocal
from api.models import (
    DashboardSave,
    Login,
    StoredFile,
    UserUsage,
)
from utilities.config import settings


async def login_information(
    user_uuid: UUID,
    source: None | Literal["app", "oauth-app"],
) -> None:
    async with AsyncWriteSessionLocal.session() as db:
        query = insert(Login).values(source=source or "app", user_uuid=user_uuid)
        await db.execute(query)
        await db.commit()


async def delete_old_saves() -> bool:
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
    return await workers_queue.worker_queue_at(
        delete_old_saves,
        next_schedule_dt(base.get_midnight(), add_days=3),
        job_timeout=1800,
    )


@repeat_every(seconds=timedelta(hours=10), wait_first=False)
async def delete_unconfirmed_files_task():
    return await workers_queue.worker_queue_at(
        delete_unconfirmed_files,
        next_schedule_dt(base.get_midnight(), add_days=2),
        job_timeout=1800,
    )


@repeat_every(seconds=timedelta(minutes=2), wait_first=True, max_repetitions=1)
async def delete_unconfirmed_files_no_delay_task():
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
    async with AsyncReadSessionLocal.session() as db:
        if usage_type == "limits":
            return await get_user_limits(db, uuid)

        if usage_type == "file":
            file_sum_query = select(func.sum(StoredFile.size)).where(
                StoredFile.creater_uuid == uuid
            )
            total_file_bytes = (await db.execute(file_sum_query)).scalar_one_or_none()
            return total_file_bytes

        if usage_type == "copilot":
            usage_query = await db.execute(
                select(
                    UserUsage.number_copilot_calls_day_count,
                    UserUsage.number_copilot_tokens_day_count,
                )
                .where(UserUsage.user_uuid == uuid)
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

    total_file_upload_size_gb_count = (
        (total_file_bytes / (1024**3)) if total_file_bytes else 0
    )

    try:
        cache_data = {
            "copilot_calls_limit": limits.copilot_calls_day,
            "copilot_tokens_limit": limits.copilot_tokens_day,
            "file_upload_size_limit": limits.upload_size_gb,
            "number_copilot_calls_day_count": (
                0 if reset_copilot_calls else (copilot_calls_day_count or 0)
            ),
            "number_copilot_tokens_day_count": (
                0 if reset_copilot_calls else (copilot_tokens_day_count or 0)
            ),
            "total_file_upload_size_gb_count": total_file_upload_size_gb_count or 0,
        }

        settings.redis_cache(f"usage:{user_uuid}", cache_data, update=True)
        return UsageGet(**cache_data)
    except Exception as e:
        logger.exception(e)

    return None


async def user_usage(reset_copilot_calls: bool = False):
    logger.info("Starting user_usage task")
    async with AsyncWriteSessionLocal.session() as db:
        query = select(UserUsage.user_uuid).where(
            or_(
                UserUsage.number_copilot_calls_day_count != 0,
                UserUsage.number_copilot_tokens_day_count != 0,
            )
        )
        results = (await db.execute(query)).scalars().all()

        for user_uuid in results:

            if cache_data := settings.redis_cache(f"usage:{user_uuid}"):
                cache_data = UsageGet.model_validate(cache_data)

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
                update(UserUsage)
                .where(UserUsage.user_uuid == user_uuid)
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

    logger.info("Finished user_usage task")
    return True


@repeat_every(seconds=timedelta(minutes=5), wait_first=False)
async def user_usage_task():
    return await workers_queue.worker_queue(
        user_usage,
        "user_usage",
        result_ttl=base.get_result_ttl(timedelta(minutes=4)),
        job_timeout=1800,
    )


async def user_usage_cache_task(user_uuid: UUID):
    return await update_user_usage_cache(user_uuid)


async def reset_copilot_calls():
    return await user_usage(reset_copilot_calls=True)


@repeat_every(seconds=timedelta(hours=2), wait_first=False)
async def reset_copilot_calls_task():
    return await workers_queue.worker_queue_at(
        reset_copilot_calls,
        next_schedule_dt(base.get_midnight()),
        job_timeout=1800,
    )


@repeat_every(seconds=timedelta(minutes=1), wait_first=True)
async def release_provider_tokens_task():
    await provider_tokens.sweep()


async def start_background_tasks():
    await release_provider_tokens_task()
    await reset_copilot_calls_task()
    await user_usage_task()
    await delete_old_saves_task()
    await delete_unconfirmed_files_task()

    clear_datetime = datetime.strptime(
        settings.CLEAR_UNCONFIRMED_FILES_DATE, "%Y-%m-%d"
    )

    if base.get_now().day == clear_datetime.day:
        await delete_unconfirmed_files_no_delay_task()

    return True
