"""
The lock that lets one process at a time run the database migrations.

A holder that stops before it finishes leaves the lock in Redis to expire. A process that waits for it
must then take it over: once the key is gone nobody is left to say ``done``, so waiting only for the
holder's answer is waiting forever (the API of a stack that Docker restarted all at once never started).
"""

from datetime import timedelta
from typing import Any

from utilities.migration_lock import (
    DONE,
    LOCK_EXPIRY,
    LOCK_KEY,
    wait_for_migration_lock,
)

POD = "pod-me"


class FakeRedisCache:
    """``settings.redis_cache`` over a dict: asked with data it takes a key that is free."""

    def __init__(self, held: dict[str, Any] | None = None):
        self.keys: dict[str, Any] = dict(held or {})
        self.calls: list[tuple[str, Any, timedelta | None]] = []

    def __call__(self, key: str, data: Any = None, expire: timedelta | None = None):
        self.calls.append((key, data, expire))
        if key in self.keys:
            return self.keys[key]
        if data is None:
            return False  # as the real one does for a key that is not there
        self.keys[key] = data
        return data


def wait(cache: FakeRedisCache, on_sleep=None, announced: list[str] | None = None):
    sleeps: list[float] = []

    def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        assert len(sleeps) < 50, "waited and waited: the lock was never taken"
        if on_sleep:
            on_sleep(len(sleeps))

    messages = announced if announced is not None else []
    result = wait_for_migration_lock(cache, POD, sleep=sleep, announce=messages.append, poll_seconds=5)
    return result, sleeps, messages


def test_takes_the_lock_when_nobody_holds_it():
    cache = FakeRedisCache()

    result, sleeps, messages = wait(cache)

    assert result == POD
    assert sleeps == []
    assert messages == []
    assert cache.keys == {LOCK_KEY: POD}
    assert cache.calls == [(LOCK_KEY, POD, LOCK_EXPIRY)]


def test_waits_while_another_holds_it_and_says_who_once():
    cache = FakeRedisCache({LOCK_KEY: "pod-other"})

    def other_finishes(sleeps: int):
        if sleeps == 3:
            cache.keys[LOCK_KEY] = DONE

    result, sleeps, messages = wait(cache, other_finishes)

    assert result == DONE
    assert sleeps == [5, 5, 5]
    assert messages == ["🛑 Another migration in progress by pod pod-other, waiting to acquire lock..."]


def test_skips_the_migrations_another_has_applied():
    cache = FakeRedisCache({LOCK_KEY: DONE})

    result, sleeps, _ = wait(cache)

    assert result == DONE
    assert sleeps == []


def test_takes_the_lock_over_when_the_holder_stopped_and_it_expired():
    cache = FakeRedisCache({LOCK_KEY: "pod-dead"})

    def lock_expires(sleeps: int):
        if sleeps == 2:
            del cache.keys[LOCK_KEY]  # the two minutes of a holder that never finished

    result, sleeps, messages = wait(cache, lock_expires)

    assert result == POD
    assert sleeps == [5, 5]
    assert cache.keys == {LOCK_KEY: POD}
    assert len(messages) == 1


def test_takes_the_lock_each_time_it_asks_so_that_a_gone_lock_is_not_waited_for():
    cache = FakeRedisCache({LOCK_KEY: "pod-dead"})

    wait(cache, lambda sleeps: cache.keys.pop(LOCK_KEY, None))

    assert all(call == (LOCK_KEY, POD, LOCK_EXPIRY) for call in cache.calls)
    assert len(cache.calls) >= 2
