import asyncio
import threading

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from utilities.config import DatabaseSessionManager, DatabaseSettings


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    yield


class _WriterAFailure(Exception):
    ...


async def test_concurrent_async_sqlite_sessions_are_isolated(tmp_path):
    manager = DatabaseSessionManager(f"sqlite:///{tmp_path / 'isolation.db'}")
    async with manager.connect() as connection:
        await connection.execute(text("CREATE TABLE rows (label TEXT)"))

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


def test_concurrent_sync_sqlite_sessions_are_isolated(tmp_path):
    db_settings = DatabaseSettings(
        DATABASE_TYPE="sqlite", DB_PATH=str(tmp_path / "isolation_sync.db")
    )
    engine = db_settings.get_write_engine()
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE rows (label TEXT)"))

    a_inserted = threading.Event()
    b_done = threading.Event()

    def writer_a():
        try:
            with Session(engine) as session:
                session.execute(text("INSERT INTO rows VALUES ('a-rolled-back')"))
                a_inserted.set()
                b_done.wait(timeout=2.0)
                raise _WriterAFailure()
        except _WriterAFailure:
            pass

    def writer_b():
        a_inserted.wait(timeout=5.0)
        with Session(engine) as session:
            session.execute(text("INSERT INTO rows VALUES ('b-committed')"))
            session.commit()
        b_done.set()

    thread_a = threading.Thread(target=writer_a)
    thread_b = threading.Thread(target=writer_b)
    thread_a.start()
    thread_b.start()
    thread_a.join(timeout=10.0)
    thread_b.join(timeout=10.0)

    with Session(engine) as session:
        labels = session.execute(text("SELECT label FROM rows")).scalars().all()
    engine.dispose()

    assert labels == ["b-committed"]
