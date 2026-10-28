import pytest


@pytest.fixture(autouse=True)
def reset_rate_limiter():
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
    yield
    from api.auth_helpers import close_app_redis

    await close_app_redis()
