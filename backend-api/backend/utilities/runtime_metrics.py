from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Mapping
from typing import Any

import anyio
from loguru import logger
from prometheus_client import REGISTRY
from prometheus_client.core import GaugeMetricFamily

from utilities.config import settings

_POOL_COUNTERS = (
    ("checked_out", "checkedout"),
    ("checked_in", "checkedin"),
    ("size", "size"),
    ("overflow", "overflow"),
)
_THREADPOOL_COUNTERS = (
    ("borrowed", "borrowed_tokens"),
    ("total", "total_tokens"),
)
_SYNC_ENGINES = (
    ("sync_read", "ReadSessionLocal"),
    ("sync_write", "WriteSessionLocal"),
)
_ASYNC_ENGINES = (
    ("async_read", "AsyncReadSessionLocal"),
    ("async_write", "AsyncWriteSessionLocal"),
    ("async_validate", "AsyncValidateUserSessionLocal"),
)

POOL_STATES = tuple(state for state, _ in _POOL_COUNTERS)
THREADPOOL_STATES = tuple(state for state, _ in _THREADPOOL_COUNTERS)
ENGINE_NAMES = tuple(name for name, _ in (*_SYNC_ENGINES, *_ASYNC_ENGINES))
LABEL_VALUES = {
    "db_pool_connections": {"engine": ENGINE_NAMES, "state": POOL_STATES},
    "threadpool_tokens": {"state": THREADPOOL_STATES},
}

_snapshot: dict[str, Any] = {"pools": {}, "threadpool": {}, "loop_lag_seconds": 0.0}
_started = False


def _pool_stats(engines: Mapping[str, Any]) -> dict[str, dict[str, float]]:
    stats: dict[str, dict[str, float]] = {}
    for name, engine in engines.items():
        pool = getattr(engine, "pool", None)
        if pool is None:
            continue
        engine_stats: dict[str, float] = {}
        for state, attr in _POOL_COUNTERS:
            fn = getattr(pool, attr, None)
            if not callable(fn):
                continue
            try:
                engine_stats[state] = float(fn())
            except Exception:  # noqa: BLE001, S112
                continue
        if engine_stats:
            stats[name] = engine_stats
    return stats


def _engines() -> dict[str, Any]:
    from api import database  # noqa: PLC0415

    engines: dict[str, Any] = {}
    for name, attr in _SYNC_ENGINES:
        sessionmaker_ = getattr(database, attr, None)
        bind = sessionmaker_.kw.get("bind") if sessionmaker_ is not None else None
        if bind is not None:
            engines[name] = bind
    for name, attr in _ASYNC_ENGINES:
        manager = getattr(database, attr, None)
        engine = getattr(manager, "_engine", None) if manager is not None else None
        if engine is not None:
            engines[name] = engine
    return engines


class RuntimeCollector:
    def collect(self):  # noqa: PLR6301
        pools = GaugeMetricFamily(
            "db_pool_connections",
            "SQLAlchemy connection pool counters",
            labels=["engine", "state"],
        )
        for engine_name, states in _snapshot["pools"].items():
            for state, value in states.items():
                pools.add_metric([engine_name, state], value)
        yield pools

        threadpool = GaugeMetricFamily(
            "threadpool_tokens",
            "anyio default threadpool capacity limiter (FastAPI sync routes)",
            labels=["state"],
        )
        for state, value in _snapshot["threadpool"].items():
            threadpool.add_metric([state], value)
        yield threadpool

        lag = GaugeMetricFamily(
            "event_loop_lag_seconds",
            "Event loop scheduling delay (elapsed beyond the sampler's sleep)",
        )
        lag.add_metric([], float(_snapshot["loop_lag_seconds"]))
        yield lag


async def _sampler(interval: float) -> None:
    while True:
        start = time.perf_counter()
        await asyncio.sleep(interval)
        _snapshot["loop_lag_seconds"] = max(0.0, time.perf_counter() - start - interval)

        try:
            limiter = anyio.to_thread.current_default_thread_limiter()
            _snapshot["threadpool"] = {state: float(getattr(limiter, attr)) for state, attr in _THREADPOOL_COUNTERS}
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"threadpool sample failed: {exc}")

        try:
            _snapshot["pools"] = _pool_stats(_engines())
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"pool stats sample failed: {exc}")


def start_runtime_metrics(interval: float | None = None) -> None:
    global _started  # noqa: PLW0603
    if interval is None:
        interval = settings.RUNTIME_METRICS_INTERVAL
    if _started:
        return
    _started = True
    with contextlib.suppress(ValueError):
        REGISTRY.register(RuntimeCollector())
    asyncio.create_task(_sampler(interval))
