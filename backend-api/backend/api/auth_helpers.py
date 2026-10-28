import asyncio
import json
import re
import secrets
import weakref
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import jwt
from fastapi import HTTPException, Request, Response, WebSocket, status
from fastapi.responses import JSONResponse
from fastapi.security.utils import get_authorization_scheme_param
from jwt import ExpiredSignatureError, PyJWTError
from sqlalchemy import ColumnElement, delete, insert, select
from sqlalchemy.engine.row import Row
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from utilities.config import settings

from . import base, crypto, database, models
from .context import session_uuid_ctx

ALGORITHM = "HS256"


credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

SESSION_COOKIE = "__Host-ws_session"
TOTP_COOKIE = "__Host-ws_totp"
CLIENT_HEADER = "X-Workspace-Client"
WEB_CLIENT = "web"

WEB_SOURCES = ("app", "oauth-app")
TOTP_ENROLL_SOURCES = {"app": "totp-enroll", "oauth-app": "totp-enroll-oauth"}

CredentialKind = Literal["web", "totp"]
CREDENTIAL_SOURCES: dict[CredentialKind, tuple[str, ...]] = {
    "web": WEB_SOURCES,
    "totp": tuple(TOTP_ENROLL_SOURCES.values()),
}

TOTP_ENROLL_LIFETIME = timedelta(minutes=5)
AGENT_TOKEN_LIFETIME = timedelta(minutes=30)
PASSWORD_RESET_LIFETIME = timedelta(hours=24)
AGENT_PATHS = frozenset({"/app/user", "/app/usage", "/app/copilot/authorize"})

CREDENTIAL_HEADERS = (
    "cookie",
    "authorization",
    "x-workspace-authorization",
    "x-metering-authorization",
)


class NoStoreMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not any(
            header in Headers(scope=scope) for header in CREDENTIAL_HEADERS
        ):
            await self.app(scope, receive, send)
            return

        async def send_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_no_store)


def is_allowed_origin(origin: str | None) -> bool:
    if origin is None:
        return False
    pattern = settings.BACKEND_CORS_ORIGIN_REGEX
    return origin in settings.BACKEND_CORS_ORIGINS or (
        pattern is not None and re.fullmatch(pattern, origin) is not None
    )


HEALTH_PATHS = frozenset({"/health", "/healthz"})


class AllowedOriginMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] not in {"http", "websocket"}
            or (scope["type"] == "http" and scope["path"] in HEALTH_PATHS)
            or is_allowed_origin(Headers(scope=scope).get("origin"))
        ):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": status.WS_1008_POLICY_VIOLATION})
            return
        refusal = JSONResponse(
            {"detail": "Requests must come from an allowed origin"},
            status_code=status.HTTP_403_FORBIDDEN,
        )
        await refusal(scope, receive, send)


async def create_login_token(
    db: AsyncSession,
    user_uuid: UUID,
    expires_delta: timedelta,
    app_session: bool = False,
    source: str = "",
) -> str:
    token = secrets.token_urlsafe(32)
    query = insert(models.Session).values(
        token_hash=crypto.hash_token(token),
        user_uuid=user_uuid,
        expiration_date=base.get_now() + expires_delta,
        app_session=app_session,
        source=source,
    )
    await db.execute(query)
    await db.commit()
    return token


async def delete_user_app_sessions(
    db: AsyncSession,
    user_uuid: UUID,
    sources: list[Literal["app", "oauth-app"]],
) -> None:
    filters = [
        models.Session.user_uuid == user_uuid,
        models.Session.app_session.is_(True),
        models.Session.source.in_(sources),
    ]

    query = await db.execute(select(models.Session).where(*filters))

    if session_results := query.scalars().all():
        for session in session_results:
            await db.delete(session)

    await db.commit()


def set_session_cookie(
    response: Response, name: str, token: str, lifetime: timedelta
) -> None:
    response.set_cookie(
        name,
        token,
        max_age=int(lifetime.total_seconds()),
        path="/",
        secure=True,
        httponly=True,
        samesite="strict",
    )


def clear_session_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path="/", secure=True, httponly=True, samesite="strict")


def clearing_cookie(refusal: HTTPException, name: str) -> HTTPException:
    cleared = Response()
    clear_session_cookie(cleared, name)
    return HTTPException(
        refusal.status_code,
        detail=refusal.detail,
        headers={**(refusal.headers or {}), "Set-Cookie": cleared.headers["set-cookie"]},
    )


def check_browser_sign_in(request: Request) -> None:
    if request.headers.get(CLIENT_HEADER) != WEB_CLIENT:
        raise HTTPException(
            400, detail=f'Sign in with the {CLIENT_HEADER} header "{WEB_CLIENT}"'
        )


@dataclass(frozen=True, slots=True)
class Credential:
    kind: CredentialKind
    token: str

    @property
    def sources(self) -> tuple[str, ...]:
        return CREDENTIAL_SOURCES[self.kind]


def read_credential(request: Request, *, enrollment: bool = False) -> Credential:
    if request.headers.get(CLIENT_HEADER) != WEB_CLIENT:
        raise credentials_exception
    if enrollment and (token := request.cookies.get(TOTP_COOKIE)):
        return Credential("totp", token)
    if not (token := request.cookies.get(SESSION_COOKIE)):
        raise credentials_exception
    return Credential("web", token)


def session_filters(
    credential: Credential, app_session: bool = False
) -> list[ColumnElement[bool]]:
    filters = [
        models.Session.token_hash == crypto.hash_token(credential.token),
        models.Session.source.in_(credential.sources),
        models.User.deleted.is_(False),
    ]
    if app_session:
        filters.append(models.Session.app_session.is_(True))
    return filters


async def refuse_expired(session_uuid: UUID, expiration_date: datetime | None) -> None:
    if expiration_date is not None and expiration_date > base.get_now():
        return
    async with database.AsyncWriteSessionLocal.session() as db:
        await db.execute(delete(models.Session).where(models.Session.uuid == session_uuid))
        await db.commit()
    raise credentials_exception


async def end_session(db: AsyncSession, session_uuid: UUID) -> None:
    await db.execute(delete(models.Session).where(models.Session.uuid == session_uuid))
    await db.commit()
    await revoke_agent_tokens(session_uuid)


class CustomRow:
    def __init__(self, **kwargs: dict[str, Any]):
        for key, value in kwargs.items():
            setattr(self, key, value)


class GetCurrentUser:
    def __init__(
        self,
        columns: list[str],
        tables: None | list[str] = None,
        app_session: bool = False,
        agent: bool = False,
        enrollment: bool = False,
    ):
        self.columns = columns
        self.tables = tables if tables else []
        self.app_session = app_session
        self.agent = agent
        self.enrollment = enrollment

    async def __call__(self, request: Request):
        if self.agent and (user := await self._agent_user(request)) is not None:
            return user
        credential = read_credential(request, enrollment=self.enrollment)
        return await current_user(
            session_filters(credential, self.app_session), self.columns, self.tables
        )

    async def _agent_user(self, request: Request) -> CustomRow | None:
        if CLIENT_HEADER in request.headers:
            return None
        scheme, token = get_authorization_scheme_param(request.headers.get("Authorization"))
        if scheme.lower() != "bearer" or not token:
            return None
        if (grant := await find_agent_token(token)) is None:
            return None
        user_uuid, session_uuid = grant
        filters = [
            models.Session.uuid == session_uuid,
            models.Session.user_uuid == user_uuid,
            models.Session.source.in_(WEB_SOURCES),
            models.Session.app_session.is_(True),
            models.User.deleted.is_(False),
        ]
        user = await current_user(filters, self.columns, self.tables)
        user.via_agent = True
        return user


class GetCurrentUserOptional:
    def __init__(self, columns: list[str], tables: None | list[str] = None):
        self.columns = columns
        self.tables = tables if tables else []

    async def __call__(self, request: Request):
        try:
            credential = read_credential(request)
            return await current_user(
                session_filters(credential), self.columns, self.tables
            )
        except HTTPException:
            return None


async def current_user(
    filters: list[ColumnElement[bool]], columns: list[str], tables: list[str]
) -> CustomRow:
    user = await generate_user_query(filters, columns, tables)
    await refuse_expired(user.session_uuid, user.expiration_date)
    user.via_agent = False
    session_uuid_ctx.set(user.session_uuid)
    return user


async def get_table_task(filters: list[ColumnElement[bool]], table: str):
    async with database.AsyncReadSessionLocal.session() as db:
        real_table = getattr(models, table)
        to_return = (
            select(models.Session.expiration_date, real_table)
            .where(*filters)
            .join(models.User, models.User.uuid == models.Session.user_uuid)
            .join(real_table, real_table.user_uuid == models.User.uuid, isouter=True)
        )

        return [
            result.get(table)
            for result in (await db.execute(to_return)).mappings().all()
            if result.get(table) is not None
        ]


async def get_columns_task(filters: list[ColumnElement[bool]], columns: list[str]):
    async with database.AsyncReadSessionLocal.session() as db:
        real_cols = [getattr(models.User, col) for col in columns]
        to_return = (
            select(
                models.Session.uuid.label("session_uuid"),
                models.Session.source.label("session_source"),
                models.Session.expiration_date,
                *real_cols,
            )
            .where(*filters)
            .join(models.User, models.User.uuid == models.Session.user_uuid)
        )

        return (await db.execute(to_return)).all()


async def generate_user_query(
    filters: list[ColumnElement[bool]],
    columns: list[str],
    tables: list[str],
) -> CustomRow:
    tasks = [asyncio.create_task(get_columns_task(filters, columns))] + [
        asyncio.create_task(get_table_task(filters, table)) for table in tables
    ]

    gathered = await asyncio.gather(*tasks)
    cols_results = gathered[0]
    table_results = gathered[1:] if tables else []

    if not cols_results:
        raise credentials_exception

    tables_dict: dict[str, list[Row]] = {}
    for table, value in zip(tables, table_results):
        tables_dict[table] = value

    all_results = flatten_results(cols_results, tables_dict)
    return all_results


def flatten_results(col_results: list[Row], table_results: dict[str, list[Row]]):
    to_set = col_results[0]._asdict()
    for table, value in table_results.items():
        to_set[table] = value

    return CustomRow(**to_set)


async def _current_session_row(request: Request, *columns, permissions: bool = False):
    credential = read_credential(request)
    query = (
        select(
            models.Session.uuid.label("session_uuid"),
            models.Session.expiration_date,
            *columns,
        )
        .select_from(models.Session)
        .join(models.User, models.User.uuid == models.Session.user_uuid)
        .where(*session_filters(credential))
    )
    if permissions:
        query = query.join(
            models.PermissionsEntityMap,
            models.User.permissions_uuid == models.PermissionsEntityMap.uuid,
        )
    async with database.AsyncReadSessionLocal.session() as db:
        session = (await db.execute(query)).first()
    if session is None:
        raise credentials_exception
    await refuse_expired(session.session_uuid, session.expiration_date)
    session_uuid_ctx.set(session.session_uuid)
    return session


async def get_current_superuser(request: Request) -> models.User:
    session = await _current_session_row(request, models.User)
    if not session.User.is_superuser:
        raise HTTPException(403, detail="User is not a superuser")
    return session.User


async def get_current_admin(request: Request):
    session = await _current_session_row(
        request,
        models.User.permissions_uuid,
        models.User.is_superuser,
        models.User.uuid,
        models.User.email,
        models.PermissionsEntityMap.name,
        permissions=True,
    )
    if session.name != models.ADMIN_TYPE:
        raise HTTPException(403, detail="User is not an admin")
    return session


def app_redis_key(name: str) -> str:
    return f"app:{{cluster}}:{name}" if settings.REDIS_CLUSTER_MODE else name


def _agent_token_key(token_hash: str) -> str:
    return app_redis_key(f"agent_token:{token_hash}")


def _session_agent_tokens_key(session_uuid: UUID) -> str:
    return app_redis_key(f"agent_tokens:{session_uuid}")


_app_redis_clients: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, Any] = weakref.WeakKeyDictionary()


@asynccontextmanager
async def app_redis() -> AsyncIterator[Any]:
    loop = asyncio.get_running_loop()
    if (client := _app_redis_clients.get(loop)) is None:
        client = _app_redis_clients[loop] = settings.get_async_redis_session("app")
    yield client


async def close_app_redis() -> None:
    if (client := _app_redis_clients.pop(asyncio.get_running_loop(), None)) is not None:
        await client.aclose()


async def mint_agent_token(user: CustomRow) -> tuple[str, int]:
    remaining = int((user.expiration_date - base.get_now()).total_seconds())
    lifetime = max(1, min(int(AGENT_TOKEN_LIFETIME.total_seconds()), remaining))
    token = secrets.token_urlsafe(32)
    token_hash = crypto.hash_token(token)
    record = json.dumps(
        {"user_uuid": str(user.uuid), "session_uuid": str(user.session_uuid)}
    )
    tokens_key = _session_agent_tokens_key(user.session_uuid)
    async with app_redis() as redis:
        await redis.set(_agent_token_key(token_hash), record, ex=lifetime)
        await redis.sadd(tokens_key, token_hash)
        await redis.expire(tokens_key, lifetime)
    return token, lifetime


async def find_agent_token(token: str) -> tuple[UUID, UUID] | None:
    async with app_redis() as redis:
        record = await redis.get(_agent_token_key(crypto.hash_token(token)))
    if record is None:
        return None
    grant = json.loads(record)
    return UUID(grant["user_uuid"]), UUID(grant["session_uuid"])


async def revoke_agent_tokens(session_uuid: UUID) -> None:
    tokens_key = _session_agent_tokens_key(session_uuid)
    async with app_redis() as redis:
        for member in await redis.smembers(tokens_key):
            token_hash = member.decode() if isinstance(member, bytes) else member
            await redis.delete(_agent_token_key(token_hash))
        await redis.delete(tokens_key)


def _password_reset_key(token_hash: str) -> str:
    return app_redis_key(f"password_reset:{token_hash}")


def _user_password_reset_key(user_uuid: UUID) -> str:
    return app_redis_key(f"password_reset_user:{user_uuid}")


def _text(value: bytes | str) -> str:
    return value.decode() if isinstance(value, bytes) else value


async def issue_password_reset(user_uuid: UUID) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = crypto.hash_token(token)
    lifetime = int(PASSWORD_RESET_LIFETIME.total_seconds())
    async with app_redis() as redis:
        earlier = await redis.set(
            _user_password_reset_key(user_uuid), token_hash, ex=lifetime, get=True
        )
        if earlier is not None:
            await redis.delete(_password_reset_key(_text(earlier)))
        await redis.set(_password_reset_key(token_hash), str(user_uuid), ex=lifetime)
    return token


async def take_password_reset(token: str) -> UUID | None:
    async with app_redis() as redis:
        user_uuid = await redis.getdel(_password_reset_key(crypto.hash_token(token)))
        if user_uuid is None:
            return None
        await redis.delete(_user_password_reset_key(UUID(_text(user_uuid))))
    return UUID(_text(user_uuid))


@dataclass(frozen=True, slots=True)
class WebSocketSession:
    user_uuid: UUID
    session_uuid: UUID
    expiration_date: datetime


async def websocket_session(websocket: WebSocket) -> WebSocketSession | None:
    if not (token := websocket.cookies.get(SESSION_COOKIE)):
        return None
    filters = session_filters(Credential(WEB_CLIENT, token), app_session=True)
    try:
        user = await generate_user_query(filters, ["uuid"], [])
        await refuse_expired(user.session_uuid, user.expiration_date)
    except HTTPException:
        return None
    return WebSocketSession(user.uuid, user.session_uuid, user.expiration_date)


async def web_session_alive(session_uuid: UUID) -> bool:
    query = (
        select(models.Session.expiration_date)
        .join(models.User, models.User.uuid == models.Session.user_uuid)
        .where(
            models.Session.uuid == session_uuid,
            models.Session.source.in_(WEB_SOURCES),
            models.Session.app_session.is_(True),
            models.User.deleted.is_(False),
        )
    )
    async with database.AsyncReadSessionLocal.session() as db:
        expiration_date = (await db.execute(query)).scalar_one_or_none()
    return expiration_date is not None and expiration_date > base.get_now()


def decode_jwt(token: str) -> dict[str, str]:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=ALGORITHM)  # type: ignore


def token_checker(token: str, requirement: dict[str, str]) -> None:
    try:
        payload = decode_jwt(token)

        for key, value in requirement.items():
            token_value: None | str = payload.get(key, None)
            if value != token_value:
                raise credentials_exception
    except PyJWTError as e:
        raise credentials_exception from e


def check_service_token(token: str) -> None:
    for sub in ["workspace", "copilot", "app"]:
        with suppress(Exception):
            return token_checker(token, {"sub": sub})

    raise credentials_exception


METERING_HEADER = "X-Metering-Authorization"
METERING_SUBJECT = "metering"


def check_metering(request: Request) -> None:
    scheme, token = get_authorization_scheme_param(
        request.headers.get(METERING_HEADER, "")
    )
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(403, detail="Usage can only be reported by the Copilot service")
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[ALGORITHM],
            options={"require": ["exp"]},
        )
    except ExpiredSignatureError as e:
        raise HTTPException(
            403,
            detail=(
                "The metering token has expired. Mint a new one with "
                "`python -m scripts.create_metering_token` and set INES_METERING_TOKEN to it."
            ),
        ) from e
    except PyJWTError as e:
        raise HTTPException(403, detail="Invalid metering token") from e
    if payload.get("sub") != METERING_SUBJECT:
        raise HTTPException(403, detail="Invalid metering token")


CURRENT_APP_USER = {
    "columns": [
        "username",
        "email",
        "uuid",
        "first_name",
        "last_name",
        "display_settings",
    ],
    "tables": ["ApiSource", "FileWidget"],
    "app_session": True,
}
