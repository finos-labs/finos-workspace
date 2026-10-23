import contextlib
from collections.abc import Callable, Coroutine
from datetime import datetime, timedelta
from typing import Any, ParamSpec, TypeVar

from rq.timeouts import JobTimeoutException

from utilities.rq_results import get_results, rq_que

P = ParamSpec("P")
T = TypeVar("T")


async def worker_queue(
    callback: Callable[P, Coroutine[Any, Any, T] | T],
    cmd_name: str,
    *args: P.args,
    result_ttl: timedelta | int = 30,
    sleep: float = 10,
    failure_ttl: int = 5,
    **kwargs: P.kwargs,
) -> T:
    job_timeout = kwargs.pop("job_timeout", None)
    if isinstance(result_ttl, timedelta):
        result_ttl = result_ttl.total_seconds()

    unpack_args: list[P] = list(args)
    with contextlib.suppress(TypeError):
        unpack_args.extend(kwargs.values())

    job_key = f"{cmd_name}{unpack_args}"
    results: T | None = None

    try:
        return await get_results(sleep, job_key)
    except JobTimeoutException:
        return None
    except Exception:
        job = rq_que.enqueue(
            callback,
            *args,
            **kwargs,
            job_id=job_key,
            result_ttl=result_ttl,
            failure_ttl=failure_ttl,
            job_timeout=job_timeout,
        )
        results = await get_results(sleep, job.id)

    if results is None:
        raise Exception("Something went wrong")

    return results


async def worker_queue_at(
    callback: Callable[P, Coroutine[Any, Any, T] | T],
    schedule: datetime,
    *args: P.args,
    result_ttl: timedelta | int = 30,
    sleep: float = 10,
    failure_ttl: int = 5,
    **kwargs: P.kwargs,
) -> T:
    job_timeout = kwargs.pop("job_timeout", 1800)

    if isinstance(result_ttl, timedelta):
        result_ttl = result_ttl.total_seconds()

    unpack_args: list[P] = list(args)
    with contextlib.suppress(TypeError):
        unpack_args.extend(kwargs.values())

    job_key = f"{callback.__name__}{unpack_args}"
    results: T | None = None

    try:
        return await get_results(sleep, job_key)
    except JobTimeoutException:
        return None
    except Exception:
        job = rq_que.enqueue_at(
            schedule,
            callback,
            *args,
            **kwargs,
            job_id=job_key,
            result_ttl=result_ttl,
            failure_ttl=failure_ttl,
            job_timeout=job_timeout,
        )
        results = await get_results(sleep, job.id)

    if results is None:
        raise Exception("Something went wrong")

    return results
