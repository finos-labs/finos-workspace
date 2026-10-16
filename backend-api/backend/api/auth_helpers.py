"""Functions that help with authentication

A session is a random token (256 bits) that the client holds and whose SHA-256 hash the
session table stores. How a request carries it depends on the client:

- The web app and the admin panel are browsers: their session is an HttpOnly cookie,
  `__Host-ws_session` and `__Host-ws_admin`. Every request that rides one names its client
  in the `X-Workspace-Client` header ("web" or "admin"), which picks the cookie.
- The Excel add-in sends `Authorization: Bearer <token>`. A session of the web app or the
  admin panel is never accepted as a bearer.
- The default Copilot acts for the signed-in user with an agent token, a bearer that GET
  /app/user, PUT /app/usage and POST /app/copilot/authorize accept and nothing else.

Every request names one of BACKEND_CORS_ORIGINS in its Origin header, on every path but
the health checks (AllowedOriginMiddleware): a browser sends its page's origin, and a service
that is not a browser sends the origin it is configured with (WORKSPACE_ORIGIN).
"""

import asyncio
import json
import re
import secrets
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
from jwt import PyJWTError
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

# The session cookies, one per browser client, and the cookie of a pending two-factor
# enrollment (POST /totp and POST /totp/activate only)
SESSION_COOKIE = "__Host-ws_session"
ADMIN_COOKIE = "__Host-ws_admin"
TOTP_COOKIE = "__Host-ws_totp"
CLIENT_HEADER = "X-Workspace-Client"
WEB_CLIENT = "web"
ADMIN_CLIENT = "admin"
CLIENT_COOKIES = {WEB_CLIENT: SESSION_COOKIE, ADMIN_CLIENT: ADMIN_COOKIE}

# Session sources: who signed in
WEB_SOURCES = ("app", "oauth-app")
ADMIN_SOURCE = "admin"
# A pending two-factor enrollment, by the web app's sign-in it finishes
TOTP_ENROLL_SOURCES = {"app": "totp-enroll", "oauth-app": "totp-enroll-oauth"}
# The clients that are not browsers, whose sessions are bearer tokens
BEARER_SOURCES = ("excel",)

CredentialKind = Literal["web", "admin", "totp", "bearer"]
# The sessions each way of carrying a token may hold
CREDENTIAL_SOURCES: dict[CredentialKind, tuple[str, ...]] = {
    "web": WEB_SOURCES,
    "admin": (ADMIN_SOURCE,),
    "totp": tuple(TOTP_ENROLL_SOURCES.values()),
    "bearer": BEARER_SOURCES,
}

TOTP_ENROLL_LIFETIME = timedelta(minutes=5)
AGENT_TOKEN_LIFETIME = timedelta(minutes=30)
PASSWORD_RESET_LIFETIME = timedelta(hours=24)
# The routes on which an agent token is accepted
AGENT_PATHS = frozenset({"/app/user", "/app/usage", "/app/copilot/authorize"})

# The headers that carry a credential: a session cookie, or a token
CREDENTIAL_HEADERS = (
    "cookie",
    "authorization",
    "x-workspace-authorization",
    "x-metering-authorization",
)


class NoStoreMiddleware:
    """Keeps every answer to a request that carried a credential out of every cache:
    `Cache-Control: no-store`, unless the route set its own. Such answers hold the user's
    data and the secrets the browser must use (data-backend and custom-agent headers), and
    a browser writes a cacheable answer to its disk cache."""

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
    """Whether `origin` is exactly one of BACKEND_CORS_ORIGINS, or matches
    BACKEND_CORS_ORIGIN_REGEX as a whole."""
    if origin is None:
        return False
    pattern = settings.BACKEND_CORS_ORIGIN_REGEX
    return origin in settings.BACKEND_CORS_ORIGINS or (
        pattern is not None and re.fullmatch(pattern, origin) is not None
    )


# The health checks of Docker, Kubernetes and the like, which send no Origin: they carry no
# credential and read nothing
HEALTH_PATHS = frozenset({"/health", "/healthz"})


class AllowedOriginMiddleware:
    """Refuses every request and websocket whose Origin header is not an allowed origin
    (is_allowed_origin), on every path but the health checks (HEALTH_PATHS), before anything
    else sees it: 403 for a request, and a websocket is closed before its handshake is
    accepted."""

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


# --- Sessions -------------------------------------------------------------------------


async def create_login_token(
    db: AsyncSession,
    user_uuid: UUID,
    expires_delta: timedelta,
    app_session: bool = False,
    source: str = "",
) -> str:
    """Creates a session for the given user and returns its token, which only the client
    keeps: the session table stores its hash."""
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
    sources: list[Literal["app", "oauth-app", "excel"]],
) -> None:
    """Deletes the given user's app sessions from the given sources

    Parameters
    ----------
    db : AsyncSession
        The database session
    user_uuid : UUID
        The user's UUID
    sources : list[Literal["app", "oauth-app", "excel"]]
        The sources to be deleted
    """
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
    """Hands a browser its session: host-only (`__Host-`), HttpOnly, Secure and SameSite
    Strict, for the session's lifetime.

    Host-only means the API's host, whatever the port: browsers scope cookies by host and
    count http://localhost as secure. So on localhost (Lite, the compose stack) the cookie
    also reaches every other server on a local port that the browser navigates to or loads
    a frame or an image from, and such a server could set one of its own. A deployment
    serves the API on a host of its own, which no other server shares."""
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
    """`refusal` that also clears the browser's cookie `name`: the API's exception handler
    sends an exception's headers with it."""
    cleared = Response()
    clear_session_cookie(cleared, name)
    return HTTPException(
        refusal.status_code,
        detail=refusal.detail,
        headers={**(refusal.headers or {}), "Set-Cookie": cleared.headers["set-cookie"]},
    )


def check_browser_sign_in(request: Request, client: str) -> None:
    """A sign-in that hands out a session cookie comes from the client's page, which names
    the client (its origin is an allowed one, as every request's is)."""
    if request.headers.get(CLIENT_HEADER) != client:
        raise HTTPException(400, detail=f'Sign in with the {CLIENT_HEADER} header "{client}"')


@dataclass(frozen=True, slots=True)
class Credential:
    """A session token as a request carried it."""

    kind: CredentialKind
    token: str

    @property
    def sources(self) -> tuple[str, ...]:
        return CREDENTIAL_SOURCES[self.kind]


def read_credential(request: Request, *, enrollment: bool = False) -> Credential:
    """The session token of a request: the cookie that its X-Workspace-Client header
    names, or else a bearer token. With `enrollment` (POST /totp and POST /totp/activate),
    a web client's pending two-factor enrollment cookie comes first."""
    client = request.headers.get(CLIENT_HEADER)
    if client is None:
        scheme, token = get_authorization_scheme_param(request.headers.get("Authorization"))
        if scheme.lower() != "bearer" or not token:
            raise credentials_exception
        return Credential("bearer", token)

    if client not in CLIENT_COOKIES:
        raise credentials_exception
    if enrollment and client == WEB_CLIENT and (token := request.cookies.get(TOTP_COOKIE)):
        return Credential("totp", token)
    if not (token := request.cookies.get(CLIENT_COOKIES[client])):
        raise credentials_exception
    return Credential("web" if client == WEB_CLIENT else "admin", token)


def session_filters(
    credential: Credential, app_session: bool = False
) -> list[ColumnElement[bool]]:
    """The session a credential holds: its hash, of a source it may carry, of a user who
    is not deleted. An admin panel session holds only while its user is a superuser: one
    who no longer is has no panel session left."""
    filters = [
        models.Session.token_hash == crypto.hash_token(credential.token),
        models.Session.source.in_(credential.sources),
        models.User.deleted.is_(False),
    ]
    if credential.kind == ADMIN_CLIENT:
        filters.append(models.User.is_superuser.is_(True))
    if app_session:
        filters.append(models.Session.app_session.is_(True))
    return filters


async def refuse_expired(session_uuid: UUID, expiration_date: datetime | None) -> None:
    """An expired session is deleted and refused; there is no grace period."""
    if expiration_date is not None and expiration_date > base.get_now():
        return
    async with database.AsyncWriteSessionLocal.session() as db:
        await db.execute(delete(models.Session).where(models.Session.uuid == session_uuid))
        await db.commit()
    raise credentials_exception


async def end_session(db: AsyncSession, session_uuid: UUID) -> None:
    """Deletes a session and revokes the agent tokens minted for it."""
    await db.execute(delete(models.Session).where(models.Session.uuid == session_uuid))
    await db.commit()
    await revoke_agent_tokens(session_uuid)


class CustomRow:
    def __init__(self, **kwargs: dict[str, Any]):
        for key, value in kwargs.items():
            setattr(self, key, value)


class GetCurrentUser:
    """Gets the current user and specified columns"""

    def __init__(
        self,
        columns: list[str],
        tables: None | list[str] = None,
        app_session: bool = False,
        agent: bool = False,
        enrollment: bool = False,
    ):
        """Initializes the class

        Parameters
        ----------
        columns : list[str]
            The columns to be returned
        tables : None | list[str]
            The tables to be joined
        app_session : bool
            Whether to require the session to be a session of the app
        agent : bool
            Whether the route also accepts an agent token (AGENT_PATHS only)
        enrollment : bool
            Whether the route also accepts a pending two-factor enrollment (POST /totp
            and POST /totp/activate only)
        """

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
        """The user an agent token acts for, while the web session it was minted from
        lasts; None when the request carries no agent token."""
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
    """Like GetCurrentUser but returns None when no valid session is provided."""

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
    """The user of the session that `filters` select, with the given columns and tables,
    and `session_uuid`, `session_source` and `expiration_date` of the session. Refuses a
    session that is missing or expired."""
    user = await generate_user_query(filters, columns, tables)
    await refuse_expired(user.session_uuid, user.expiration_date)
    user.via_agent = False
    session_uuid_ctx.set(user.session_uuid)
    return user


async def get_table_task(filters: list[ColumnElement[bool]], table: str):
    """Gets the table for the given user

    Parameters
    ----------
    filters : list[ColumnElement[bool]]
        The filters that select the current session
    table : str
        The table to be returned
    """
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
    """Gets the columns for the given user

    Parameters
    ----------
    filters : list[ColumnElement[bool]]
        The filters that select the current session
    columns : list[str]
        The columns to be returned
    """
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
    """Generates a query for the given user

    Parameters
    ----------
    filters : list[ColumnElement[bool]]
        The filters that select the current session
    columns : list[str]
        The user columns to be returned
    tables : list[str]
        The tables that will be joined to the User table
    """

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
    """Flattens the results of the columns and tables

    Parameters
    ----------
    col_results : list[Row]
        The results of the columns
    table_results : dict[str, list[Row]
        The results of the tables
    """
    to_set = col_results[0]._asdict()
    for table, value in table_results.items():
        to_set[table] = value

    return CustomRow(**to_set)


async def _current_session_row(request: Request, *columns, permissions: bool = False):
    """The session of a request joined with its user (and with `permissions`, the user's
    permissions map), with the given columns, or 401."""
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
    """
    Gets the current superuser from the database

    Parameters
    ----------
    request : Request
        The request, which carries the session
    """
    session = await _current_session_row(request, models.User)
    # Signed in, but not allowed: 401 would sign the user out of the web app
    if not session.User.is_superuser:
        raise HTTPException(403, detail="User is not a superuser")
    return session.User


async def get_current_admin(request: Request):
    """
    Gets the current admin from the database

    Parameters
    ----------
    request : Request
        The request, which carries the session
    """
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


# --- Agent tokens ---------------------------------------------------------------------


def app_redis_key(name: str) -> str:
    """A key in the app's Redis database. In cluster mode every key carries one hash tag,
    as settings.redis_cache does, so that a session's keys are on one node."""
    return f"app:{{cluster}}:{name}" if settings.REDIS_CLUSTER_MODE else name


def _agent_token_key(token_hash: str) -> str:
    return app_redis_key(f"agent_token:{token_hash}")


def _session_agent_tokens_key(session_uuid: UUID) -> str:
    return app_redis_key(f"agent_tokens:{session_uuid}")


@asynccontextmanager
async def app_redis() -> AsyncIterator[Any]:
    """A client of the app's Redis database, closed on exit."""
    client = settings.get_async_redis_session("app")
    try:
        yield client
    finally:
        await client.aclose()


async def mint_agent_token(user: CustomRow) -> tuple[str, int]:
    """A new agent token for the user's web session and its lifetime in seconds: 30
    minutes, or what is left of the session when that is less. Only its hash is kept, in
    Redis, with the session's set of tokens so that signing out revokes them."""
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
    """The user and the session an agent token was minted for, while it is valid."""
    async with app_redis() as redis:
        record = await redis.get(_agent_token_key(crypto.hash_token(token)))
    if record is None:
        return None
    grant = json.loads(record)
    return UUID(grant["user_uuid"]), UUID(grant["session_uuid"])


async def revoke_agent_tokens(session_uuid: UUID) -> None:
    """Revokes every agent token minted for a session."""
    tokens_key = _session_agent_tokens_key(session_uuid)
    async with app_redis() as redis:
        for member in await redis.smembers(tokens_key):
            token_hash = member.decode() if isinstance(member, bytes) else member
            await redis.delete(_agent_token_key(token_hash))
        await redis.delete(tokens_key)


# --- Password reset links -------------------------------------------------------------


def _password_reset_key(token_hash: str) -> str:
    return app_redis_key(f"password_reset:{token_hash}")


def _user_password_reset_key(user_uuid: UUID) -> str:
    return app_redis_key(f"password_reset_user:{user_uuid}")


def _text(value: bytes | str) -> str:
    return value.decode() if isinstance(value, bytes) else value


async def issue_password_reset(user_uuid: UUID) -> str:
    """The token of a new link with which the user sets their password: it works once,
    within PASSWORD_RESET_LIFETIME. Only its hash is kept, in Redis, and the user's
    earlier link stops working."""
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
    """The user a password reset link was issued for, and the link is used up: None when
    it expired, was used already or a newer link replaced it."""
    async with app_redis() as redis:
        user_uuid = await redis.getdel(_password_reset_key(crypto.hash_token(token)))
        if user_uuid is None:
            return None
        await redis.delete(_user_password_reset_key(UUID(_text(user_uuid))))
    return UUID(_text(user_uuid))


# --- The bridge websocket -------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class WebSocketSession:
    """The web session that opened a websocket."""

    user_uuid: UUID
    session_uuid: UUID
    expiration_date: datetime


async def websocket_session(websocket: WebSocket) -> WebSocketSession | None:
    """The web session of a websocket handshake from the web app, with a valid web session
    cookie. A browser cannot set the client header on a websocket, so the cookie is read
    directly; its origin is an allowed one, as every websocket's is."""
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
    """Whether a web session still lasts: not signed out, replaced by a new sign-in, ended
    by a password change or reset, or expired, and of a user who is not deleted. The
    session table is the one record of that for every worker."""
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


# --- Service tokens -------------------------------------------------------------------


def decode_jwt(token: str) -> dict[str, str]:
    """Decodes the given JWT token

    Parameters
    ----------
    token : str
        The token to be decoded
    """
    return jwt.decode(token, settings.JWT_SECRET, algorithms=ALGORITHM)  # type: ignore


ON_PREM_TOKEN: dict | None = None
if settings.is_onprem():
    with suppress(Exception):
        ON_PREM_TOKEN = decode_jwt(settings.WORKSPACE_AUTH_TOKEN)


def token_checker(token: str, requirement: dict[str, str]) -> None:
    """Checks that the given token matches the given requirements

    Parameters
    ----------
    token : str
        The token to be checked
    requirement : dict[str, str]
        The requirements to be checked against
    """
    try:
        payload = decode_jwt(token)

        if ON_PREM_TOKEN:
            token_value: None | str = payload.get("auth", None)
            if token_value != ON_PREM_TOKEN.get("auth"):
                raise credentials_exception
            # token matches, so we can return
            return

        for key, value in requirement.items():
            token_value: None | str = payload.get(key, None)
            if value != token_value:
                raise credentials_exception
    except PyJWTError as e:
        raise credentials_exception from e


def check_service_token(token: str) -> None:
    """Checks that the given token is a workspace service token (WORKSPACE_AUTH_TOKEN)."""
    for sub in ["workspace", "copilot", "excel", "app"]:
        with suppress(Exception):
            return token_checker(token, {"sub": sub})

    raise credentials_exception


METERING_HEADER = "X-Metering-Authorization"
METERING_SUBJECT = "metering"


def check_metering(request: Request) -> None:
    """Checks that the request comes from the service that meters Copilot usage.

    Usage is written with a service token (``sub: metering``, signed with
    ``JWT_SECRET``) that only the operator and the Copilot service hold. Users
    authenticate as themselves and cannot mint it, so they cannot change the
    usage that their limits are checked against.
    """
    scheme, token = get_authorization_scheme_param(
        request.headers.get(METERING_HEADER, "")
    )
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(403, detail="Usage can only be reported by the Copilot service")
    try:
        payload = decode_jwt(token)
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
