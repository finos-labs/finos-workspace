"""The lock that lets one process at a time run the database migrations.

Every API start runs the migrations, and several processes can start together (a container restarted by
the Docker daemon, a scaled deployment). The first takes a lock in Redis, the others wait for it to say
``done``.
"""

import time
from collections.abc import Callable
from datetime import timedelta
from typing import Any

LOCK_KEY = "alembic_migrations"
LOCK_EXPIRY = timedelta(minutes=2)
DONE = "done"


def wait_for_migration_lock(
    redis_cache: Callable[..., Any],
    pod: str,
    *,
    sleep: Callable[[float], None] = time.sleep,
    announce: Callable[[str], None] = print,
    poll_seconds: float = 5,
) -> str:
    """Take the lock, or wait for the process that holds it. Returns ``pod`` when this process holds the
    lock and ``done`` when another has applied the migrations.

    Asking with this process's id takes the lock when nobody holds it and says who holds it otherwise. A
    holder that was stopped before it finished leaves the lock to expire, and then a waiter takes it over:
    waiting only for the holder's answer waits forever, because the key is gone and nobody is left to say
    ``done`` (that is how the API of a stack whose containers were all restarted at once never started).
    """
    announced = False
    while (holder := redis_cache(LOCK_KEY, pod, expire=LOCK_EXPIRY)) not in {pod, DONE}:
        if not announced:
            announce(f"🛑 Another migration in progress by pod {holder}, waiting to acquire lock...")
            announced = True
        sleep(poll_seconds)
    return holder
