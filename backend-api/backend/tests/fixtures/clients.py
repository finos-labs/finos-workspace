"""HTTP client fixtures for backend tests."""

from contextlib import ExitStack
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .base import (
    _ADMIN_USER,
    _AUTH_USER,
    _SECOND_USER,
    TEST_BASE_URL,
    WEB_HEADERS,
    _cleanup_user_fixture_records,
    _create_session_record,
    _create_user_fixture,
    _get_test_db_url_async,
    _get_test_db_url_sync,
    _make_auth_client,
    app,
)
from .db import TestAsyncSessionLocal


@pytest.fixture(scope="function")
async def client(db_session, apply_migrations):
    """Unauthenticated test client with DB overrides."""
    from api.database import aget_read_db, aget_write_db
    from sqlalchemy import create_engine

    test_db_url = _get_test_db_url_async()
    test_engine = create_async_engine(test_db_url, echo=False, pool_pre_ping=True)

    TestSessionLocal = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=True,
    )

    sync_test_db_url = _get_test_db_url_sync()
    sync_test_engine = create_engine(sync_test_db_url, echo=False, pool_pre_ping=True)

    test_async_read = TestAsyncSessionLocal(TestSessionLocal)
    test_async_write = TestAsyncSessionLocal(TestSessionLocal)

    async def override_async_get_db():
        yield db_session

    app.dependency_overrides[aget_read_db] = override_async_get_db
    app.dependency_overrides[aget_write_db] = override_async_get_db

    with ExitStack() as stack:
        stack.enter_context(
            patch("api.database.AsyncReadSessionLocal", test_async_read)
        )
        stack.enter_context(
            patch("api.database.AsyncWriteSessionLocal", test_async_write)
        )
        stack.enter_context(
            patch("api.auth_helpers.database.AsyncReadSessionLocal", test_async_read)
        )
        # The usage cache is refreshed in sessions of its own, during requests too
        stack.enter_context(
            patch("api.worker_tasks.AsyncReadSessionLocal", test_async_read)
        )
        stack.enter_context(
            patch("api.worker_tasks.AsyncWriteSessionLocal", test_async_write)
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as ac:
            yield ac

    app.dependency_overrides.clear()
    await test_engine.dispose()
    sync_test_engine.dispose()


@pytest.fixture(scope="function")
async def app_client(client):
    """The web app before sign-in: its client header and origin. A sign-in sets the
    session cookie, which the client keeps and sends."""
    client.headers.update(WEB_HEADERS)
    yield client


async def _signed_in_client(db_session, user_config):
    await _cleanup_user_fixture_records(db_session, user_config)
    await _create_user_fixture(db_session, user_config)
    return await _create_session_record(
        db_session,
        user_config["user_uuid"],
        user_config["session_uuid"],
        user_config["session_source"],
    )


@pytest.fixture(scope="function")
async def auth_client(client, db_session):
    """The web app signed in as the standard test user."""
    token = await _signed_in_client(db_session, _AUTH_USER)
    async with _make_auth_client(token) as auth_ac:
        yield auth_ac


@pytest.fixture(scope="function")
async def admin_client(client, db_session):
    """The web app signed in as the admin of the admin's organization."""
    token = await _signed_in_client(db_session, _ADMIN_USER)
    async with _make_auth_client(token) as admin_ac:
        yield admin_ac


@pytest.fixture(scope="function")
async def second_user_client(client, db_session):
    """The web app signed in as a second user, for cross-user tests."""
    token = await _signed_in_client(db_session, _SECOND_USER)
    async with _make_auth_client(token) as second_ac:
        yield second_ac
