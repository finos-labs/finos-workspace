"""Functions that help with authentication"""

import asyncio
import random
import re
from contextlib import suppress
from datetime import timedelta
from typing import Annotated, Any, Literal, TypeAlias
from uuid import UUID

import jwt
from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from fastapi.security.utils import get_authorization_scheme_param
from jwt import ExpiredSignatureError, PyJWTError
from sqlalchemy import delete, insert, select, update
from sqlalchemy.engine.row import Row
from sqlalchemy.ext.asyncio import AsyncSession

from api.statics import butterfly_species
from utilities.config import settings

from . import base, database, models

ALGORITHM = "HS256"
SESSION_GRACE_PERIOD = timedelta(minutes=5)


credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

ProviderT: TypeAlias = Literal["microsoft", "google", "okta"]

OAUTH_PROVIDERS: dict[ProviderT, str] = {
    "microsoft": "https://graph.microsoft.com/v1.0/me",
    "google": "https://www.googleapis.com/oauth2/v3/userinfo",
    "okta": f"{settings.OKTA_DOMAIN}/oauth2/v1/userinfo",
}
OAUTH_PATHS = [f"/app/{provider}-auth" for provider in OAUTH_PROVIDERS]


VALID_PATHS = [
    "/app/login",
    "/app/validate-and-sync",
    "/app/dash/validate-and-sync",
    *OAUTH_PATHS,
]

LOCALHOST_ORIGINS = [
    "http://localhost:1420",
    "https://localhost:1420",
    "http://localhost",
]


def check_valid(origin: str, url_path: str) -> bool:
    """Checks that the given origin or path is valid

    Parameters
    ----------
    origin : str
        The origin to be checked
    url_path : str
        The path to be checked
    """

    origin = origin or ""

    VALID_ORIGINS = settings.BACKEND_CORS_ORIGINS
    if settings.DISABLE_CORS:
        return True

    if any(url_path.startswith(path) for path in VALID_PATHS):
        return True

    valid_pattern = settings.BACKEND_CORS_ORIGIN_REGEX is not None and bool(
        re.fullmatch(settings.BACKEND_CORS_ORIGIN_REGEX, origin)
    )

    return origin in VALID_ORIGINS or valid_pattern


class OriginOAuth2Token(OAuth2PasswordBearer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    async def __call__(self, request: Request) -> str | None:
        origin = request.headers.get("Origin")
        service_auth = request.headers.get("X-Workspace-Authorization")
        service_scheme, service_param = get_authorization_scheme_param(service_auth)

        is_bearer = service_scheme.lower() == "bearer"
        if not check_valid(origin, request.url.path) and not is_bearer:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not allowed to access this endpoint",
            )

        if is_bearer and not service_param:
            raise credentials_exception

        return service_param or settings.WORKSPACE_AUTH_TOKEN


origin_oauth2_scheme = OriginOAuth2Token(tokenUrl="token")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)


async def create_login_token(  # noqa: PLR0913,PLR0917
    db: AsyncSession,
    user_uuid: UUID,
    expires_delta: None | timedelta = None,
    api_token: None | str = None,
    app_session: bool = False,
    source: str = "",
) -> str:
    """Creates a session for given user"""
    expiration = base.get_now()
    if expires_delta is None:
        expiration += timedelta(minutes=15)
    else:
        expiration += expires_delta
    query = insert(models.Session).values(
        user_uuid=user_uuid,
        expiration_date=expiration,
        api_token=api_token,
        app_session=app_session,
        source=source,
    )
    response = await db.execute(query)
    await db.commit()
    return str(response.inserted_primary_key[0])  # type: ignore


async def delete_user_app_sessions(
    db: AsyncSession,
    user_uuid: UUID,
    sources: list[Literal["app", "oauth-app", "excel"]] | None = None,
) -> None:
    """Deletes all app sessions for the given user

    Parameters
    ----------
    db : AsyncSession
        The database session
    user_uuid : UUID
        The user's UUID
    sources : list[Literal["app", "oauth-app", "excel"]] | None
        The sources to be deleted
    """
    filters = [models.Session.user_uuid == user_uuid, models.Session.app_session.is_(True)]

    if sources:
        filters.append(models.Session.source.in_(sources))

    query = await db.execute(select(models.Session).where(*filters))

    if session_results := query.scalars().all():
        for session in session_results:
            await db.delete(session)
            base.remove_session_redis(session.uuid)

    await db.commit()


def create_jwt(data: dict, expires_delta: None | timedelta = None) -> str:
    """Creates a JWT token

    Parameters
    ----------
    data : dict
        The data to be encoded in the token
    expires_delta : None | timedelta
        The time until the token expires
    """
    to_encode = data.copy()
    expire = (
        base.get_now() + expires_delta
        if expires_delta
        else base.get_now() + timedelta(minutes=15)
    )
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=ALGORITHM)
    return encoded_jwt  # type: ignore


def create_jwt_timeless(data: dict) -> str:
    """Creates a JWT token that does not expire

    Parameters
    ----------
    data : dict
        The data to be encoded in the token
    """
    return jwt.encode(data, settings.JWT_SECRET, algorithm=ALGORITHM)  # type: ignore


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


class CustomRow:
    def __init__(self, **kwargs: dict[str, Any]):
        for key, value in kwargs.items():
            setattr(self, key, value)

    @classmethod
    def logout(cls):
        return cls(uuid=None, expiration_date=base.get_now() - timedelta(days=1))


async def check_session_expiration(
    result: CustomRow,
    token: UUID | str,
    db: AsyncSession | None = None,
    from_logout: bool = False,
) -> CustomRow:
    """Checks the session expiration for the given user.

    If the session is expired, it will either extend the expiration date
    by 5 minutes (if within the grace period) or delete the session.

    This avoids force logging out users who are currently active but whose
    sessions have technically expired.

    Parameters
    ----------
    result : CustomRow
        The result from the user query
    token : UUID | str
        The session token
    db : AsyncSession | None
        The database session
    from_logout : bool
        Whether the query is being generated from a logout request
    """
    if not result.expiration_date:
        return result

    is_expired = result.expiration_date < base.get_now()

    if not is_expired:
        return result

    newly_expired = result.expiration_date + SESSION_GRACE_PERIOD > base.get_now()

    token = UUID(token) if isinstance(token, str) else token

    async def update_session(db: AsyncSession):
        if newly_expired:
            new_exp = base.get_now() + SESSION_GRACE_PERIOD
            query = (
                update(models.Session)
                .where(models.Session.uuid == token)
                .values(expiration_date=new_exp)
            )
            setattr(result, "expiration_date", new_exp)
        else:
            query = delete(models.Session).where(models.Session.uuid == token)
            base.remove_session_redis(token)

        await db.execute(query)
        await db.commit()

    if db:
        await update_session(db)
    else:
        async with database.AsyncWriteSessionLocal.session() as db_session:
            await update_session(db_session)

    if not newly_expired and not from_logout:
        raise credentials_exception

    return result


class GetCurrentUser:
    """Gets the current user and specified columns"""

    def __init__(
        self,
        columns: list[str],
        tables: None | list[str] = None,
        app_session: bool = False,
        from_logout: bool = False,
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
        from_logout : bool
            Whether the query is being generated from a logout request
        """

        self.columns = columns
        self.tables = tables if tables else []
        self.app_session = app_session
        self.from_logout = from_logout

    async def __call__(self, token: Annotated[str, Depends(oauth2_scheme)]):
        return await self.call_logic(
            token, self.columns, self.tables, self.app_session, self.from_logout
        )

    @staticmethod
    async def call_logic(
        token: str, columns, tables, app_session: bool = False, from_logout: bool = False
    ):
        try:
            clean_token = UUID(token)
        except:  # noqa: E722
            if from_logout:
                return CustomRow.logout()
            raise credentials_exception

        cleaned = await generate_user_query(
            clean_token, columns, tables, app_session, from_logout
        )
        setattr(cleaned, "token", clean_token)
        if from_logout and getattr(cleaned, "uuid", None) is None:
            base.remove_session_redis(token)
            return cleaned

        return await check_session_expiration(cleaned, token, from_logout=from_logout)


class GetCurrentUserOptional:
    """Like GetCurrentUser but returns None when no token is provided."""

    def __init__(self, columns: list[str], tables: None | list[str] = None):
        self.columns = columns
        self.tables = tables if tables else []

    async def __call__(
        self, token: Annotated[str | None, Depends(oauth2_scheme_optional)] = None
    ):
        if token is None:
            return None
        try:
            return await GetCurrentUser.call_logic(token, self.columns, self.tables)
        except HTTPException:
            return None


class GetCurrentUserCookie(GetCurrentUser):
    """This is currently unused and only here in case Jose wants to switch from
    header to cookie authentication.
    """

    async def __call__(self, access_token: Annotated[str, Cookie()]):  # type: ignore
        return await GetCurrentUser.call_logic(access_token, self.columns, self.tables)


async def get_table_task(token: UUID, table: str, app_session: bool = False):
    """Gets the table for the given user

    Parameters
    ----------
    token : UUID
        The current session token
    table : str
        The table to be returned
    app_session : bool
        Whether to require the session to be a session of the app
    """
    async with database.AsyncReadSessionLocal.session() as db:
        real_table = getattr(models, table)
        to_return = (
            select(models.Session.expiration_date, real_table)
            .where(
                models.Session.uuid == token,
                models.User.deleted.is_(False),
            )
            .join(models.User, models.User.uuid == models.Session.user_uuid)
            .join(real_table, real_table.user_uuid == models.User.uuid, isouter=True)
        )
        if app_session:
            to_return = to_return.where(models.Session.app_session.is_(True))

        return [
            result.get(table)
            for result in (await db.execute(to_return)).mappings().all()
            if result.get(table) is not None
        ]


async def get_columns_task(token: UUID, columns: list[str], app_session: bool = False):
    """Gets the columns for the given user

    Parameters
    ----------
    token : UUID
        The current session token
    columns : list[str]
        The columns to be returned
    app_session : bool
        Whether to require the session to be a session of the app
    """
    async with database.AsyncReadSessionLocal.session() as db:
        real_cols = [getattr(models.User, col) for col in columns]
        to_return = (
            select(models.Session.expiration_date, *real_cols)
            .where(
                models.Session.uuid == token,
                models.User.deleted.is_(False),
            )
            .join(models.User, models.User.uuid == models.Session.user_uuid)
        )
        if app_session:
            to_return = to_return.where(models.Session.app_session.is_(True))

        return (await db.execute(to_return)).all()


async def generate_user_query(
    token: UUID,
    columns: list[str],
    tables: list[str],
    app_session: bool = False,
    from_logout: bool = False,
) -> CustomRow:
    """Generates a query for the given user

    Parameters
    ----------
    db : Session
    token : UUID
        The current session token
    columns : list[str]
        The user columns to be returned
    tables : list[str]
        The tables that will be joined to the User table
    app_session : bool
        Whether to require the session to be a session of the app
    from_logout : bool
        Whether the query is being generated from a logout request
    """

    tasks = [asyncio.create_task(get_columns_task(token, columns, app_session))] + [
        asyncio.create_task(get_table_task(token, table, app_session)) for table in tables
    ]

    gathered = await asyncio.gather(*tasks)
    cols_results = gathered[0]
    table_results = gathered[1:] if tables else []

    if not cols_results:
        if from_logout:
            return CustomRow.logout()
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


async def get_current_superuser(
    token: str = Depends(oauth2_scheme),
) -> models.User:
    """
    Gets the current superuser from the database

    Parameters
    ----------
    token : str
        The token to be decoded
    db : Session
        The database session
    """
    try:
        UUID(token)
    except:  # noqa: E722
        raise credentials_exception
    query2 = (
        select(models.Session.expiration_date, models.User)
        .select_from(models.Session)
        .join(models.User, models.User.uuid == models.Session.user_uuid)
        .where(models.Session.uuid == token, models.User.deleted.is_(False))
    )
    async with database.AsyncWriteSessionLocal.session() as db:
        session = (await db.execute(query2)).first()
        if session is None:
            raise credentials_exception

        await check_session_expiration(session, token, db)

        if not session.User.is_superuser:
            raise credentials_exception
        return session.User


async def get_current_admin(
    token: str = Depends(oauth2_scheme),
):
    """
    Gets the current admin from the database

    Parameters
    ----------
    token : str
        The token to be decoded
    db : Session
        The database session
    """
    try:
        token_uuid = UUID(token)
    except:  # noqa: E722
        raise credentials_exception
    query2 = (
        select(
            models.Session.expiration_date,
            models.User.permissions_uuid,
            models.User.is_superuser,
            models.User.uuid,
            models.User.email,
            models.PermissionsEntityMap.name,
        )
        .select_from(models.Session)
        .join(models.User, models.User.uuid == models.Session.user_uuid)
        .join(
            models.PermissionsEntityMap,
            models.User.permissions_uuid == models.PermissionsEntityMap.uuid,
        )
        .where(
            models.Session.uuid == token_uuid,
            models.User.deleted.is_(False),
        )
    )

    async with database.AsyncWriteSessionLocal.session() as db:
        session = (await db.execute(query2)).first()
        if session is None:
            raise credentials_exception
        if session.name != "Admin":
            raise HTTPException(403, detail="User is not an admin")

        await check_session_expiration(session, token, db)
        return session


def is_valid_uuid(val):
    try:
        UUID(str(val))
        return True
    except ValueError:
        return False


def get_current_token(token: str = Depends(oauth2_scheme)) -> str:
    """
    Gets the current token from the header

    Parameters
    ----------
    token : str
        The token to be decoded
    """
    if not is_valid_uuid(token):
        raise HTTPException(422, detail="Token is not a valid UUID")
    return token


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


def check_origin(token: str = Depends(origin_oauth2_scheme)) -> None:
    """Checks that the given token is a workspace service token

    Parameters
    ----------
    token : str
        The token to be checked
    """
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

    The token runs out (``exp``), and one without an expiry is refused: it is a
    credential that is pasted into the configuration of another service, so one that
    never ran out could only be withdrawn by changing ``JWT_SECRET``, which signs out
    every user at the same time. ``scripts.create_metering_token`` mints a new one.
    """
    scheme, token = get_authorization_scheme_param(
        request.headers.get(METERING_HEADER, "")
    )
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(403, detail="Usage can only be reported by the Copilot service")
    try:
        # require=["exp"] refuses a token that never runs out; PyJWT checks the expiry itself.
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


def check_app(token: str = Depends(oauth2_scheme)) -> None:
    """Checks that the given token is a token of the app

    Parameters
    ----------
    token : str
        The token to be checked
    """
    token_checker(token, {"sub": "app"})


def check_lambda(token: str = Depends(oauth2_scheme)) -> None:
    """Checks that the given token is a lambda token

    Parameters
    ----------
    token : str
        The token to be checked
    """
    token_checker(token, {"sub": "lambda"})


def create_username() -> str:
    "Generate a random username which includes a butterfly name"
    butterfly = random.choice(butterfly_species)  # noqa: S311
    after = base.random_string(4)
    return f"{butterfly}_{after}"


def check_username_part(username: str) -> bool:
    """Checks that a string is a valid part of a username"""
    pattern = r"^\w{0,50}$"
    return bool(re.match(pattern, username, re.IGNORECASE))


def check_description(desc: str) -> bool:
    pattern = r"^[\w\s]+$"
    return bool(re.match(pattern, desc, re.IGNORECASE))


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
