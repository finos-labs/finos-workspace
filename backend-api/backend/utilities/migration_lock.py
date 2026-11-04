import time
from collections.abc import Callable
from datetime import timedelta
from typing import Any

LOCK_KEY = "alembic_migrations"
LOCK_EXPIRY = timedelta(minutes=2)
DONE_EXPIRY = timedelta(seconds=30)
POLL_SECONDS = 5
DONE = "done"


def wait_for_migration_lock(
    redis_cache: Callable[..., Any],
    pod: str,
    *,
    sleep: Callable[[float], None] = time.sleep,
    announce: Callable[[str], None] = print,
    poll_seconds: float = POLL_SECONDS,
) -> str:
    announced = False
    while (holder := redis_cache(LOCK_KEY, pod, expire=LOCK_EXPIRY)) not in {pod, DONE}:
        if not announced:
            announce(f"🛑 Another migration in progress by pod {holder}, waiting to acquire lock...")
            announced = True
        sleep(poll_seconds)
    return holder
