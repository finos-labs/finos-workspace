"""Reset shared state per test."""

import pytest


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Clear rate limiter state between tests."""
    from api.rate_limit import limiter

    if hasattr(limiter, "_storage") and limiter._storage is not None:
        try:
            limiter._storage.reset()
        except (AttributeError, TypeError):
            pass

    if hasattr(limiter, "reset"):
        try:
            limiter.reset()
        except (AttributeError, TypeError):
            pass

    yield


@pytest.fixture(autouse=True)
async def close_app_redis():
    """Close the test event loop's client of the app's Redis, which ends with the test."""
    yield
    from api.auth_helpers import close_app_redis

    await close_app_redis()
