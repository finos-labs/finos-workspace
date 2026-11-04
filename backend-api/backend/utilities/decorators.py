import asyncio
from asyncio import ensure_future
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime, timedelta
from functools import wraps
from traceback import format_exception
from typing import Any

from loguru import logger
from starlette.concurrency import run_in_threadpool

NoArgsNoReturnFuncT = Callable[[], None]
NoArgsNoReturnAsyncFuncT = Callable[[], Coroutine[Any, Any, None]]
NoArgsNoReturnDecorator = Callable[
    [NoArgsNoReturnFuncT | NoArgsNoReturnAsyncFuncT], NoArgsNoReturnAsyncFuncT
]


def next_schedule_dt(schedule: datetime, add_days: int = 1) -> datetime:
    if schedule.tzinfo is None:
        schedule = schedule.replace(tzinfo=UTC)

    if schedule < datetime.now(UTC):
        schedule += timedelta(days=add_days)

    return schedule


def next_execution_time(
    seconds: float | timedelta | None, schedule: datetime | None = None
) -> float:
    if seconds is None and schedule is None:
        raise ValueError("At least one of seconds or schedule must be provided")

    if schedule is None:
        return seconds.total_seconds() if isinstance(seconds, timedelta) else seconds

    now = datetime.now(UTC)

    new_schedule = next_schedule_dt(schedule)
    return (new_schedule - now).total_seconds()


def repeat_every(
    *,
    seconds: float | timedelta = None,
    schedule: datetime | None = None,
    wait_first: bool = False,
    raise_exceptions: bool = False,
    max_repetitions: int | None = None,
) -> NoArgsNoReturnDecorator:
    if seconds is None and schedule is None:
        raise ValueError("At least one of seconds or schedule must be provided")

    first_sleep = next_execution_time(seconds, schedule)

    def decorator(
        func: NoArgsNoReturnAsyncFuncT | NoArgsNoReturnFuncT,
    ) -> NoArgsNoReturnAsyncFuncT:
        is_coroutine = asyncio.iscoroutinefunction(func)

        @wraps(func)
        async def wrapped() -> None:
            repetitions = 0

            async def loop() -> None:
                nonlocal repetitions
                if wait_first:
                    await asyncio.sleep(first_sleep)
                while max_repetitions is None or repetitions < max_repetitions:
                    try:
                        if is_coroutine:
                            await func()  # type: ignore
                        else:
                            await run_in_threadpool(func)
                        repetitions += 1
                    except Exception as exc:
                        formatted_exception = "".join(
                            format_exception(type(exc), exc, exc.__traceback__)
                        )
                        logger.error(
                            f"Exception in repeated task {func.__name__}: {formatted_exception}"
                        )
                        if raise_exceptions:
                            raise exc

                    await asyncio.sleep(next_execution_time(seconds, schedule))

            ensure_future(loop())

        return wrapped

    return decorator
