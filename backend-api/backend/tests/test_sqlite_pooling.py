import asyncio

import pytest
from sqlalchemy import text

from utilities.config import DatabaseSessionManager


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    yield


class _WriterAFailure(Exception):
    ...


async def test_concurrent_async_sqlite_sessions_are_isolated(tmp_path):
    manager = DatabaseSessionManager(f"sqlite:///{tmp_path / 'isolation.db'}")
    async with manager.session() as session:
        await session.execute(text("CREATE TABLE rows (label TEXT)"))
        await session.commit()

    a_inserted = asyncio.Event()
    b_done = asyncio.Event()

    async def writer_a():
        try:
            async with manager.session() as session:
                await session.execute(
                    text("INSERT INTO rows VALUES ('a-rolled-back')")
                )
                a_inserted.set()
                try:
                    await asyncio.wait_for(b_done.wait(), timeout=2.0)
                except TimeoutError:
                    pass
                raise _WriterAFailure()
        except _WriterAFailure:
            pass

    async def writer_b():
        await a_inserted.wait()
        async with manager.session() as session:
            await session.execute(text("INSERT INTO rows VALUES ('b-committed')"))
            await session.commit()
        b_done.set()

    await asyncio.gather(writer_a(), writer_b())

    async with manager.session() as session:
        labels = (await session.execute(text("SELECT label FROM rows"))).scalars().all()
    await manager.close()

    assert labels == ["b-committed"]
