from api import auth_helpers


async def test_calls_on_one_event_loop_share_one_client(db_containers):
    async with auth_helpers.app_redis() as first, auth_helpers.app_redis() as second:
        assert first is second
        assert await first.ping()
    async with auth_helpers.app_redis() as again:
        assert again is first

    await auth_helpers.close_app_redis()

    async with auth_helpers.app_redis() as fresh:
        assert fresh is not first
        assert await fresh.ping()
