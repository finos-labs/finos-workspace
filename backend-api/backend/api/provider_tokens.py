import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from time import monotonic, time
from uuid import UUID

from fastapi import HTTPException
from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import auth_helpers, base, database, models, sign_in_providers

HEADER_NAMES = {"microsoft": "X-Microsoft-Id-Token", "okta": "X-Okta-Id-Token"}
CACHE_SECONDS = 60
CACHE_ENTRIES = 10_000
RENEW_SKEW_SECONDS = 120
LOCK_SECONDS = 20
LOCK_POLLS = 100
LOCK_POLL_SECONDS = 0.1
SWEEP_BATCH = 50


@dataclass(frozen=True, slots=True)
class Held:
    header: str
    id_token: str
    expires_at: float


_cache: dict[UUID, tuple[float, Held | None]] = {}
_inflight: dict[UUID, asyncio.Task[Held | None]] = {}


def _held(row: models.ProviderSession) -> Held:
    return Held(
        HEADER_NAMES[row.provider], row.id_token, row.id_token_expires_at.timestamp()
    )


def _fresh(held: Held) -> bool:
    return held.expires_at - time() > RENEW_SKEW_SECONDS


def _remember(session_uuid: UUID, held: Held | None) -> None:
    if session_uuid not in _cache and len(_cache) >= CACHE_ENTRIES:
        _cache.pop(next(iter(_cache)))
    _cache[session_uuid] = (monotonic(), held)


async def _row(db: AsyncSession, session_uuid: UUID) -> models.ProviderSession | None:
    return (
        await db.execute(
            select(models.ProviderSession)
            .where(models.ProviderSession.session_uuid == session_uuid)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


def _live_session(session_uuid):
    return select(models.Session.uuid).where(
        models.Session.uuid == session_uuid, models.Session.expiration_date > base.get_now()
    )


async def _alive(db: AsyncSession, session_uuid: UUID) -> bool:
    return (await db.execute(_live_session(session_uuid))).scalar_one_or_none() is not None


async def store(
    db: AsyncSession,
    email: str,
    sources: tuple[str, ...],
    tokens: sign_in_providers.ProviderTokens,
) -> None:
    session_uuid = (
        await db.execute(
            select(models.Session.uuid)
            .join(models.User, models.User.uuid == models.Session.user_uuid)
            .where(models.User.email == email, models.Session.source.in_(sources))
            .order_by(models.Session.created_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if session_uuid is None:
        return
    await take(db, session_uuid)
    db.add(
        models.ProviderSession(
            session_uuid=session_uuid,
            provider=tokens.provider,
            id_token=tokens.id_token,
            id_token_expires_at=datetime.fromtimestamp(tokens.id_token_expires_at, UTC),
            refresh_token=tokens.refresh_token,
        )
    )
    await db.commit()
    _cache.pop(session_uuid, None)


async def take(
    db: AsyncSession, session_uuid: UUID
) -> sign_in_providers.ProviderTokens | None:
    row = await _row(db, session_uuid)
    _cache.pop(session_uuid, None)
    if row is None:
        return None
    tokens = sign_in_providers.ProviderTokens(
        row.provider,
        row.id_token,
        int(row.id_token_expires_at.timestamp()),
        row.refresh_token,
    )
    await db.delete(row)
    await db.commit()
    return tokens


async def release(tokens: sign_in_providers.ProviderTokens) -> None:
    try:
        await sign_in_providers.revoke(tokens.provider, tokens.refresh_token)
    except HTTPException as refusal:
        logger.warning(
            "{} could not revoke the refresh token at sign-out: {}",
            tokens.provider,
            refusal.detail,
        )


async def _renew(db: AsyncSession, row: models.ProviderSession) -> Held | None:
    session_uuid = row.session_uuid
    key = auth_helpers.app_redis_key(f"provider_renew:{session_uuid}")
    async with auth_helpers.app_redis() as redis:
        if not await redis.set(key, "1", nx=True, ex=LOCK_SECONDS):
            for _ in range(LOCK_POLLS):
                await asyncio.sleep(LOCK_POLL_SECONDS)
                if not await redis.exists(key):
                    break
            await db.rollback()
            renewed_by_another = await _row(db, session_uuid)
            if renewed_by_another is None:
                return None
            held = _held(renewed_by_another)
            return held if _fresh(held) else None
        try:
            renewed = await sign_in_providers.refresh(row.provider, row.refresh_token)
        except sign_in_providers.TokenRevoked:
            await take(db, session_uuid)
            await auth_helpers.end_session(db, session_uuid)
            return None
        except HTTPException as refusal:
            logger.warning(
                "{} did not renew the ID token: {}", row.provider, refusal.detail
            )
            return None
        else:
            row.id_token = renewed.id_token
            row.id_token_expires_at = datetime.fromtimestamp(
                renewed.id_token_expires_at, UTC
            )
            row.refresh_token = renewed.refresh_token
            await db.commit()
            return _held(row)
        finally:
            await redis.delete(key)


async def _load(session_uuid: UUID) -> Held | None:
    async with database.AsyncWriteSessionLocal.session() as db:
        row = await _row(db, session_uuid)
        if row is None or not await _alive(db, session_uuid):
            return None
        try:
            if not sign_in_providers.provider(row.provider).keeps_tokens:
                return None
        except HTTPException:
            return None
        held = _held(row)
        return held if _fresh(held) else await _renew(db, row)


async def current(session_uuid: UUID) -> Held | None:
    if (cached := _cache.get(session_uuid)) is not None:
        loaded, held = cached
        if monotonic() - loaded < CACHE_SECONDS and (held is None or _fresh(held)):
            return held
    task = _inflight.get(session_uuid)
    if task is None:
        task = _inflight[session_uuid] = asyncio.create_task(_load(session_uuid))
        task.add_done_callback(lambda _, key=session_uuid: _inflight.pop(key, None))
    held = await asyncio.shield(task)
    _remember(session_uuid, held)
    return held


async def sweep() -> int:
    async with database.AsyncWriteSessionLocal.session() as db:
        ended = (
            (
                await db.execute(
                    select(models.ProviderSession)
                    .where(~_live_session(models.ProviderSession.session_uuid).exists())
                    .limit(SWEEP_BATCH)
                )
            )
            .scalars()
            .all()
        )
        released = 0
        for row in ended:
            tokens = sign_in_providers.ProviderTokens(
                row.provider,
                row.id_token,
                int(row.id_token_expires_at.timestamp()),
                row.refresh_token,
            )
            claimed = await db.execute(
                delete(models.ProviderSession).where(models.ProviderSession.uuid == row.uuid)
            )
            await db.commit()
            _cache.pop(row.session_uuid, None)
            if claimed.rowcount == 1:
                await release(tokens)
                released += 1
        return released
