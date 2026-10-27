"""FINOS Workspace user routes"""

from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import (
    date as dateType,
    datetime,
    timedelta,
)
from typing import Annotated, Literal
from urllib.parse import urlparse, urlsplit
from uuid import UUID

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import (
    JSONResponse,
    Response,
    StreamingResponse,
)
from loguru import logger
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import RowMapping, and_, delete, insert, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.background import BackgroundTask

from api import auth_helpers, base, crud, crypto, helpers, models, schemas, sign_in_providers
from api.database import aget_read_db, aget_write_db
from api.models import (
    User,
    UserInvite,
    UserRole,
)
from api.rate_limit import LIMIT_DEFAULT, LIMIT_FEW, exempt_service_token, limiter
from api.schemas import SuccessReturn
from routers import app_helpers
from routers.app import mcp_oauth
from routers.routers_helpers import register_app_user
from utilities.config import settings

router = APIRouter(
    prefix="/app", tags=["app"]
)


EXCEPTION_401 = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect username or password",
    headers={"WWW-Authenticate": "Bearer"},
)


async def process_create_user(
    the_uuid: UUID,
    email: str,
    db: AsyncSession,
    microsoft_id: str | None = None,
) -> UUID | bool:
    """Creates the user for a pending invite, with their organization's Agent User role;
    returns the new user's uuid, or False"""
    query = select(
        UserInvite.data,
        UserInvite.email,
        UserInvite.permissions_uuid,
    ).where(
        UserInvite.uuid == the_uuid,
        UserInvite.used.is_(False),
        UserInvite.email == email,
    )
    result = (await db.execute(query)).first()
    if result is None:
        return False

    if result.permissions_uuid is None:
        result.permissions_uuid = settings.DEFAULT_USER_MAPPING

    if await crud.check_new_user(db, result.email):
        return False
    insert_query = insert(User).values(
        email=result.email,
        clean_email=base.clean_email(result.email),
        permissions_uuid=result.permissions_uuid,
        # A random password nobody knows, stored as its bcrypt hash only: the user signs
        # in with single sign-on, or an administrator resets the password
        password=base.random_password(),
        first_name=result.data["first_name"],
        last_name=result.data["last_name"],
        app_start=base.get_now(),
        confirmed=1,
        temporary_password=True,
        microsoft_id=microsoft_id,
    )
    response = await db.execute(insert_query)
    user_uuid = response.inserted_primary_key[0]
    update_query = (
        update(UserInvite).where(UserInvite.uuid == the_uuid).values(used=True)
    )
    await db.execute(update_query)
    # Add role if provided
    if (role := result.data.get("role", None)) and role != "None" and role.strip():
        role_insert = insert(UserRole).values(
            user_uuid=user_uuid,
            role_uuid=role,
        )
        await db.execute(role_insert)
    await app_helpers.give_default_roles(
        db, user_uuid, result.permissions_uuid, [app_helpers.AGENT_USER_ROLE]
    )
    await db.commit()

    return user_uuid


@router.post("/logout", response_model=SuccessReturn)
@limiter.limit("10/minute", exempt_when=exempt_service_token)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(aget_write_db),
):
    """Signs the web app out: its sessions end, with the agent tokens minted for this one,
    and the web app's cookie is cleared even when its session had already ended."""
    credential = auth_helpers.read_credential(request)
    session = (
        await db.execute(
            select(models.Session.uuid, models.Session.user_uuid, models.Session.source)
            .join(models.User, models.User.uuid == models.Session.user_uuid)
            .where(*auth_helpers.session_filters(credential, app_session=True))
        )
    ).first()
    if session is not None:
        await auth_helpers.revoke_agent_tokens(session.uuid)
        await auth_helpers.delete_user_app_sessions(
            db, session.user_uuid, ["app", "oauth-app"]
        )
    auth_helpers.clear_session_cookie(response, auth_helpers.SESSION_COOKIE)
    return SuccessReturn(success=True)


def two_factor_required() -> JSONResponse:
    """The answer to a sign-in whose organization requires an authenticator that the user
    has not set up: 202, with no session."""
    return JSONResponse(
        content={
            "two_factor_required": True,
            "message": "Two-factor authentication is required",
        },
        status_code=202,
    )


async def _start_two_factor_enrollment(
    db: AsyncSession, user_uuid: UUID, source: str
) -> JSONResponse:
    """A sign-in whose organization requires an authenticator that the user has not set
    up: 202, and for the web app the `__Host-ws_totp` cookie, a five-minute session that
    only POST /totp and POST /totp/activate accept. Activating the authenticator finishes
    the sign-in (POST /totp/activate)."""
    pending = two_factor_required()
    if (enroll_source := auth_helpers.TOTP_ENROLL_SOURCES.get(source)) is not None:
        await db.execute(
            delete(models.Session).where(
                models.Session.user_uuid == user_uuid,
                models.Session.source.in_(auth_helpers.TOTP_ENROLL_SOURCES.values()),
            )
        )
        token = await auth_helpers.create_login_token(
            db=db,
            user_uuid=user_uuid,
            expires_delta=auth_helpers.TOTP_ENROLL_LIFETIME,
            source=enroll_source,
        )
        auth_helpers.set_session_cookie(
            pending, auth_helpers.TOTP_COOKIE, token, auth_helpers.TOTP_ENROLL_LIFETIME
        )
    return pending


async def _start_session(  # noqa: PLR0913, PLR0917
    request: Request,
    response: Response,
    db: AsyncSession,
    user_uuid: UUID,
    source: str,
    remember: bool,
) -> tuple[str, timedelta]:
    """A new session of the web app and its lifetime: it ends the web app's other sessions
    and is set as the session cookie."""
    lifetime = helpers.get_app_session_expiration(remember)
    await auth_helpers.delete_user_app_sessions(db, user_uuid, ["app", "oauth-app"])

    token = await auth_helpers.create_login_token(
        db=db,
        user_uuid=user_uuid,
        expires_delta=lifetime,
        app_session=True,
        source=source,
    )
    auth_helpers.set_session_cookie(response, auth_helpers.SESSION_COOKIE, token, lifetime)
    if auth_helpers.TOTP_COOKIE in request.cookies:
        auth_helpers.clear_session_cookie(response, auth_helpers.TOTP_COOKIE)
    return token, lifetime


@router.post("/login", response_model=schemas.AppTokenWithContext)
@limiter.limit("5/minute", exempt_when=exempt_service_token)
async def login(
    request: Request,
    response: Response,
    user: schemas.AppUserLogin,
    db: AsyncSession = Depends(aget_write_db),
):
    """Signs in. The web app's session is the `__Host-ws_session` cookie and the answer
    carries no token."""
    source = user.source or "app"
    auth_helpers.check_browser_sign_in(request)

    if not (
        result := (await db.execute(helpers.get_app_user_query(user.email))).first()
    ):
        raise EXCEPTION_401

    # A user removed from their organization is no user any more: answered as an unknown one
    if not result._asdict().get("permissions_uuid", None):
        raise EXCEPTION_401

    db_user = schemas.AppUserSchema.model_validate(result)
    app_helpers.check_login(user, db_user)  # Will raise if a problem is encountered

    if not db_user.confirmed:
        return JSONResponse(
            content={"message": "User is not confirmed"}, status_code=403
        )

    if (
        db_user.totp_secret
        and db_user.totp_active
        and not await helpers.verify_totp(
            db, db_user.uuid, db_user.totp_secret, user.totp_token
        )
    ):
        return JSONResponse(content={"message": "Invalid TOTP token"}, status_code=202)

    access = await app_helpers.get_user_access(db, db_user.uuid)

    if db_user.require_authenticator and not db_user.totp_active:
        return await _start_two_factor_enrollment(db, db_user.uuid, source)

    return await finish_sign_in(
        request,
        response,
        db,
        db_user,
        access,
        source=source,
        remember=user.remember,
        version=user.version,
    )


async def finish_sign_in(  # noqa: PLR0914
    request: Request,
    response: Response,
    db: AsyncSession,
    db_user: schemas.AppUserSchema,
    access: schemas.UserAccess,
    *,
    source: str,
    remember: bool,
    version: str | None,
) -> schemas.AppTokenWithContext:
    """Starts the session of a user who passed every check of a sign-in (POST /app/login,
    or POST /totp/activate finishing it), and answers with what the client needs."""
    show_changelog = (
        db_user.latest_version is not None and db_user.latest_version != version
    )
    if version and db_user.latest_version != version:
        update_query = (
            update(User).where(User.uuid == db_user.uuid).values(latest_version=version)
        )
        await db.execute(update_query)

    access_token, time_d = await _start_session(
        request, response, db, db_user.uuid, source, remember
    )

    # Check if the user is logging in for the first time
    is_first_login = await helpers.check_first_login(
        db, db_user.uuid, ["oauth-app", "app"]
    )

    # Enter the login into our database
    helpers.handle_add_login(db_user.uuid, source)

    # Get Copilot Chats
    chats = await app_helpers.get_copilot_chats(db, db_user.uuid)
    questions_history = await app_helpers.get_user_questions_history(db, db_user.uuid)

    # Get MCP servers: the names of their stored headers, never the values
    mcp_servers = await app_helpers.get_mcp_servers(db, db_user)

    # Get Theme Settings
    entity_theme_settings = await app_helpers.get_entity_theme_settings(
        db, db_user.entity_uuid
    )

    # Get Dashboards
    dashboards_complete = await app_helpers.get_dashboards_complete(db_user)

    # Get User Apps
    user_apps_complete = await app_helpers.get_user_apps_complete(db_user)

    # Get User Data
    curr_user = await auth_helpers.generate_user_query(
        auth_helpers.session_filters(
            auth_helpers.Credential("web", access_token)
        ),
        auth_helpers.CURRENT_APP_USER["columns"],
        auth_helpers.CURRENT_APP_USER["tables"],
    )

    # The organization's backends; a user without one has none (never compared with None)
    if db_user.entity_uuid is not None:
        entity_query = select(models.ApiSource).where(
            models.ApiSource.entity_uuid == db_user.entity_uuid
        )
        entity_backends = (await db.execute(entity_query)).scalars().all()
        if entity_backends and isinstance(curr_user.ApiSource, list):
            curr_user.ApiSource.extend(entity_backends)

    # Get Widget Metadata
    widget_metadata = await app_helpers.get_widget_metadata(db=db, user=db_user)
    user_data = await app_helpers.set_app_user_data(curr_user, db)
    user_data.widget_metadata = widget_metadata

    # Get usage
    usage = await helpers.get_user_usage(db_user)

    # Get custom copilots
    custom_copilots = await app_helpers.get_custom_copilots(db, db_user.uuid)

    # Get user skills
    user_skills = await app_helpers.get_user_skill_state(db, db_user.uuid)

    content = {
        "uuid": db_user.uuid,
        "email": db_user.email,
        "username": db_user.username,
        "expiration_date": base.get_now() + time_d,
        "temporary_password": bool(db_user.temporary_password) and source != "oauth-app",
        "force_2fa": (db_user.require_authenticator or db_user.two_factor_auth)
        and not (db_user.totp_secret and db_user.totp_active),
        "entity_name": db_user.name,
        "role": db_user.role,
        "entity_theme_settings": entity_theme_settings,
        "show_changelog": show_changelog,
        "copilot_chats": chats,
        "questions_history": questions_history,
        "dash_sync": dashboards_complete,
        "user_apps": user_apps_complete,
        "user_skills": user_skills,
        "user": user_data,
        "access": access,
        "usage": usage,
        "custom_copilots": custom_copilots,
        "mcp_servers": mcp_servers.servers if mcp_servers else None,
        "copilot_keys": await app_helpers.get_copilot_key_status(db, db_user.uuid),
        "is_first_login": is_first_login,
    }

    return schemas.AppTokenWithContext.model_validate(content)


UNVERIFIED_EMAIL = HTTPException(
    status.HTTP_403_FORBIDDEN,
    detail=(
        "Microsoft has not verified the email address of this account, so it cannot sign "
        "in to, or create, the FINOS Workspace account or invitation for that address. Sign in "
        "with your password, or ask your administrator to have Microsoft send verified "
        "emails (the xms_edov claim)."
    ),
)


async def _provider_account(
    db: AsyncSession, identity: sign_in_providers.SignInIdentity
) -> RowMapping | None:
    """The account a provider's user signs in to, or None for a new user. A Microsoft
    user is keyed on Microsoft's object id; the email finds an account that is not linked
    to a Microsoft user yet, never one linked to another. An email that the provider does
    not vouch for finds no account or invitation, and makes no new account under that
    address either (the address's owner would later sign in to it): such a sign-in is
    refused."""
    accounts = (
        select(User.uuid, User.email, User.microsoft_id)
        .where(User.deleted.is_(False))
        .limit(1)
    )
    match = User.email == identity.email
    if identity.microsoft_id:
        linked = (
            await db.execute(accounts.where(User.microsoft_id == identity.microsoft_id))
        ).mappings().first()
        if linked is not None:
            return linked
        match = and_(match, User.microsoft_id.is_(None))
    if not identity.email_verified:
        raise UNVERIFIED_EMAIL
    return (await db.execute(accounts.where(match))).mappings().first()


async def handle_oauth_user(
    request: Request,
    response: Response,
    db: AsyncSession,
    identity: sign_in_providers.SignInIdentity,
    auth_data: schemas.AuthData,
):
    """Signs a provider's user in, and up when they are new."""
    account = await _provider_account(db, identity)
    if account is None:
        user_create = schemas.UserCreateAppAdmin(
            first_name=identity.given_name,
            last_name=identity.family_name,
            email=identity.email,
            permissions_uuid=settings.DEFAULT_USER_MAPPING,
        )
        extra_info = schemas.RegisterAppUser()
        invite_uuid = await register_app_user(
            db, user_create, extra_info, from_oauth=True
        )
        if not invite_uuid or not await process_create_user(
            invite_uuid, identity.email, db, microsoft_id=identity.microsoft_id
        ):
            raise HTTPException(status_code=400, detail="Failed to create user")

    user_login = schemas.OAuthLogin(
        email=account["email"] if account else identity.email,
        remember=False,
        source="oauth-app",
        password="",
        version=auth_data.version,
    ).bypass_password_check()
    answer = await login(request, response, user_login, db)

    if (
        identity.microsoft_id
        and account is not None
        and account["microsoft_id"] is None
        and not isinstance(answer, Response)
    ):
        # The account is linked to the Microsoft user once the sign-in succeeded
        await db.execute(
            update(User)
            .where(User.uuid == account["uuid"])
            .values(microsoft_id=identity.microsoft_id)
        )
        await db.commit()
    return answer


@router.post("/reset-password", response_model=SuccessReturn)
@limiter.limit(LIMIT_FEW)
async def post_reset_password(
    request: Request,
    reset: schemas.PasswordReset,
    db: AsyncSession = Depends(aget_write_db),
):
    """Sets the password of the user an administrator's password reset link was issued
    for (POST /admin/reset-password/{user_uuid}). The link is used up, every session of
    the user ends, and the user signs in with the new password."""
    auth_helpers.check_browser_sign_in(request)
    user_uuid = await auth_helpers.take_password_reset(reset.token)
    result = (
        None
        if user_uuid is None
        else await db.execute(
            update(User)
            .where(User.uuid == user_uuid, User.deleted.is_(False))
            .values(password=reset.new_password, temporary_password=False)
        )
    )
    if result is None or result.rowcount == 0:
        raise HTTPException(
            400,
            detail="This link has expired or was used already. Ask your admin for a new one.",
        )
    await db.execute(delete(models.Session).where(models.Session.user_uuid == user_uuid))
    await db.commit()
    return SuccessReturn.success_instance()


@router.post("/sign-in/nonce", response_model=schemas.SignInNonce)
@limiter.limit(LIMIT_FEW)
async def post_sign_in_nonce(request: Request, response: Response):
    """The nonce for the web app's next sign-in with Microsoft or Okta, which only this
    browser can use, once, within five minutes (api/sign_in_providers.py)."""
    auth_helpers.check_browser_sign_in(request)
    return schemas.SignInNonce(
        nonce=await sign_in_providers.issue_sign_in_nonce(response)
    )


@router.post("/{provider}-auth", response_model=schemas.AppTokenWithContext)
@limiter.limit("5/minute")
async def oauth_auth(
    request: Request,
    response: Response,
    provider: Literal["google", "microsoft", "okta"],
    data: schemas.AuthData,
    db: AsyncSession = Depends(aget_write_db),
):
    """Endpoint for OAuth Authentication, both for sign-in and sign-up. The provider's
    token must have been issued to this deployment's client, and Microsoft's or Okta's ID
    token must carry this browser's sign-in nonce (api/sign_in_providers.py)."""
    auth_helpers.check_browser_sign_in(request)
    if provider == "google":
        identity = await sign_in_providers.google_identity(data.token)
        return await handle_oauth_user(request, response, db, identity, data)

    # The browser's nonce is used up by this attempt, whatever its outcome, so its cookie
    # is cleared with the answer, a refusal too
    nonce_hash = await sign_in_providers.take_sign_in_nonce(request)
    identify = (
        sign_in_providers.microsoft_identity
        if provider == "microsoft"
        else sign_in_providers.okta_identity
    )
    try:
        identity = await identify(data.id_token, nonce_hash)
        answer = await handle_oauth_user(request, response, db, identity, data)
    except HTTPException as refusal:
        raise auth_helpers.clearing_cookie(
            refusal, sign_in_providers.SIGN_IN_COOKIE
        ) from refusal
    sign_in_providers.clear_sign_in_cookie(
        answer if isinstance(answer, Response) else response
    )
    return answer


@router.get("/2fa", response_model=schemas.TwoFactorAuthGet)
async def get_2fa(
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(
        auth_helpers.GetCurrentUser(
            ["uuid", "two_factor_auth", "totp_active"], app_session=True
        )
    ),
):
    """Endpoint to get the 2FA status for a user."""

    entity_uuid = await app_helpers.get_entity_uuid(db, user.uuid)
    entity_require_authenticator = await app_helpers.entity_require_authenticator(
        db, entity_uuid
    )

    two_factor_auth = user.two_factor_auth or entity_require_authenticator

    return schemas.TwoFactorAuthGet(
        two_factor_auth=two_factor_auth and user.totp_active,
        entity_require_authenticator=entity_require_authenticator,
    )


@router.put("/2fa", response_model=SuccessReturn)
async def put_2fa(
    data: schemas.TwoFactorAuth,
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    query = (
        update(User)
        .where(User.uuid == user.uuid)
        .values(
            two_factor_auth=data.two_factor_auth,
            totp_active=False,
            totp_secret=None,
        )
    )
    await db.execute(query)
    await db.commit()
    return SuccessReturn.success_instance()


@router.get("/user", response_model=schemas.AppUserReturn)
async def get_user(
    db: AsyncSession = Depends(aget_read_db),
    user=Depends(auth_helpers.GetCurrentUser(**auth_helpers.CURRENT_APP_USER, agent=True)),
):
    if user.via_agent:
        # The default Copilot learns who the user is, and nothing they keep: no
        # connections, no credentials
        return schemas.AppUserReturn(
            expiration_date=user.expiration_date,
            first_name=user.first_name,
            last_name=user.last_name,
            display_settings=user.display_settings,
            file_widgets=[],
            api_sources=[],
            username=user.username,
            email=user.email,
            uuid=user.uuid,
        )
    user_data = await app_helpers.set_app_user_data(user, db)
    user_data.widget_metadata = await app_helpers.get_widget_metadata(db=db, user=user)
    return user_data


@router.get("/validate", response_model=SuccessReturn)
async def validate_user(request: Request):
    """Whether the request's app session is valid. Changes nothing, except that an
    expired session is deleted."""
    try:
        await auth_helpers.GetCurrentUser(["uuid"], app_session=True)(request)
    except HTTPException:
        return SuccessReturn.failure_instance()
    return SuccessReturn.success_instance()


@router.get("/session", response_model=schemas.AppSession)
async def get_session(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(
        auth_helpers.GetCurrentUser(
            ["uuid", "email", "first_name", "last_name", "display_settings"],
            app_session=True,
        )
    ),
):
    """The signed-in user from the web app's session cookie, as the web app needs it
    after a reload; 401 when there is none."""
    if request.headers.get(auth_helpers.CLIENT_HEADER) != auth_helpers.WEB_CLIENT:
        raise auth_helpers.credentials_exception
    account = (await db.execute(helpers.get_app_user_query(user.email))).first()
    if account is None:
        raise auth_helpers.credentials_exception
    return schemas.AppSession(
        uuid=user.uuid,
        email=user.email,
        username=account.username,
        expiration_date=user.expiration_date,
        temporary_password=bool(account.temporary_password)
        and user.session_source != "oauth-app",
        force_2fa=(account.require_authenticator or account.two_factor_auth)
        and not (account.totp_secret and account.totp_active),
        entity_name=account.name,
        role=account.role,
        access=await app_helpers.get_user_access(db, user.uuid),
        usage=await helpers.get_user_usage(user),
        copilot_keys=await app_helpers.get_copilot_key_status(db, user.uuid),
        user=schemas.SessionUser(
            first_name=user.first_name,
            last_name=user.last_name,
            display_settings=user.display_settings,
        ),
    )


@router.post("/copilot/token", response_model=schemas.AgentToken)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def post_copilot_token(
    request: Request,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """A token for the default Copilot to act for the user: 30 minutes, ending with the
    session. The web app sends it to the default Copilot only, which may read who the
    user is, record their usage and authorize their requests with it, and nothing else."""
    if request.headers.get(auth_helpers.CLIENT_HEADER) != auth_helpers.WEB_CLIENT:
        raise auth_helpers.credentials_exception
    token, lifetime = await auth_helpers.mint_agent_token(user)
    return schemas.AgentToken(token=token, expires_in=lifetime)


@router.get("/access", response_model=schemas.UserAccess)
async def get_access(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """What the user may do: their type, and what the roles an admin assigned them give."""
    return await app_helpers.get_user_access(db, user.uuid)


@router.post("/display-settings", response_model=SuccessReturn)
async def post_display_settings(
    payload: schemas.UserDisplaySettings,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    """Store the user's display settings. Provider keys are dropped from them (the schema
    does it): they go to PUT /copilot-keys."""
    query = (
        update(User).where(User.uuid == user.uuid).values(display_settings=payload)
    )
    await db.execute(query)
    await db.commit()
    return SuccessReturn.success_instance()


@router.post("/copilot-chats", response_model=schemas.UsageGet)
async def post_copilot_chats(
    chats: schemas.CopilotChatsCreate,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Endpoint to create or update copilot chats for a user.

    If the user does not have any existing chats, a new entry is created.
    If the user already has chats, the existing entry is updated with the new chats.
    The idea of this endpoint is to allow the client to manage the chats for the user and simply
    keep the server in sync with the client's state.

    Args:
        chats (schemas.CopilotChatsCreate): The chats to be created or updated.
        db (AsyncSession): The database session.
        user: The current authenticated user.

    Returns:
        SuccessReturn: An instance indicating the operation was successful.
    """

    try:
        await crud.bulk_copilot_chats_insert_update(db, user.uuid, chats)
    except SQLAlchemyError as e:
        logger.error(e)
        await db.rollback()
        raise HTTPException(
            status_code=400, detail="Could not successfully update the items"
        ) from e

    return await schemas.UsageGet.check_cache(db, user)


@router.delete("/copilot-chats", response_model=SuccessReturn)
async def delete_copilot_chats(
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Endpoint to delete copilot chats for a user.

    This endpoint deletes the copilot chats associated with the current authenticated user.

    Args:
        db (AsyncSession): The database session.
        user: The current authenticated user.

    Returns:
        SuccessReturn: An instance indicating the operation was successful.
    """
    query = delete(models.CopilotChat).where(
        models.CopilotChat.user_uuid == user.uuid,
    )
    await db.execute(query)
    await db.commit()
    return SuccessReturn.success_instance()


@router.get(
    "/copilot-chats/search", response_model=list[schemas.Chat | schemas.ChatInfo]
)
async def search_copilot_chats(
    query: Annotated[str, Query(..., min_length=2)],
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    start_date: dateType | datetime | None = None,
    end_date: dateType | datetime | None = None,
):
    """
    Endpoint to search copilot chats for a user.

    This endpoint searches the copilot chats associated with the current authenticated user
    based on the provided query string.

    Args:
        query (str): The search query string.
        db (AsyncSession): The database session.
        user: The current authenticated user.
        start_date (dateType | datetime | None, optional): The start date for filtering messages (inclusive).
        end_date (dateType | datetime | None, optional): The end date for filtering messages (inclusive).

    Returns:
        list[schemas.Chat | schemas.ChatInfo]: A list of copilot chats matching the search query.
    """

    return await crud.search_copilot_chats(db, user.uuid, query, start_date, end_date)


@router.get("/copilot-chats/{chat_uuid}", response_model=schemas.Chat)
async def get_copilot_chat(
    chat_uuid: UUID,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Endpoint to retrieve a specific copilot chat for a user.

    This endpoint fetches the copilot chat associated with the specified chat UUID
    for the current authenticated user.

    Args:
        chat_uuid (UUID): The UUID of the copilot chat to retrieve.
        db (AsyncSession): The database session.
        user: The current authenticated user.

    Returns:
        schemas.Chat: The copilot chat corresponding to the provided UUID.
    """
    where_clause = (
        models.CopilotChat.uuid == chat_uuid,
        models.CopilotChat.user_uuid == user.uuid,
    )

    query = (
        select(models.CopilotChat)
        .options(selectinload(models.CopilotChat.messages))
        .where(*where_clause)
    )
    result = (await db.execute(query)).scalar_one_or_none()
    if not result:
        raise HTTPException(
            status_code=404, detail="Copilot chat not found for the user"
        )

    chat = schemas.Chat.from_row(result)
    try:
        last_opened = base.get_now()
        chat.lastOpened = last_opened.timestamp() * 1000
        query = (
            update(models.CopilotChat)
            .where(*where_clause)
            .values(last_opened=last_opened, content=chat.to_content())
        )
        await db.execute(query)
        await db.commit()
    except SQLAlchemyError as e:
        logger.error(e)
        await db.rollback()

    return chat


@router.put(
    "/usage",
    response_model=schemas.UsageGet,
    dependencies=[Depends(auth_helpers.check_metering)],
)
async def put_usage(
    usage: schemas.UsagePut,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True, agent=True)),
):
    """Record the Copilot usage of a user.

    Only the service that serves the Copilot may call this (see
    `auth_helpers.check_metering`): the usage that limits are checked against must not be
    writable by the people the limits apply to. Users cannot add, subtract or reset it.

    A query is refused once it would exceed the daily query limit, or once the daily
    token limit is used up. Tokens are reported after a query ran, so they are always
    recorded.
    """
    limits = await schemas.UsageGet.check_cache(db, user)
    row = (
        await db.execute(
            select(
                models.UserUsage.number_copilot_calls_day_count,
                models.UserUsage.number_copilot_tokens_day_count,
            ).where(models.UserUsage.user_uuid == user.uuid)
        )
    ).first()
    calls, tokens = (row[0] or 0, row[1] or 0) if row else (0, 0)
    if usage.reset_copilot_count:
        calls, tokens = 0, 0

    add_count = usage.add_copilot_count
    new_calls = max(0, calls + add_count - usage.subtract_copilot_count)

    if add_count:
        if limits.copilot_calls_limit is not None and new_calls > limits.copilot_calls_limit:
            return schemas.UsageLimitError.limit_error(
                limits.model_copy(update={"number_copilot_calls_day_count": calls})
            )
        if limits.copilot_tokens_limit is not None and tokens >= limits.copilot_tokens_limit:
            return schemas.UsageLimitError.limit_error(
                limits.model_copy(update={"number_copilot_tokens_day_count": tokens}),
                tokens=True,
            )

    if row is None:
        query = insert(models.UserUsage).values(
            user_uuid=user.uuid,
            number_copilot_calls_day_count=new_calls,
            number_copilot_tokens_day_count=usage.add_copilot_tokens,
        )
    elif usage.reset_copilot_count:
        query = (
            update(models.UserUsage)
            .where(models.UserUsage.user_uuid == user.uuid)
            .values(
                number_copilot_calls_day_count=new_calls,
                number_copilot_tokens_day_count=usage.add_copilot_tokens,
            )
        )
    else:
        # Tokens are added in the database so that concurrent queries do not overwrite
        # each other
        query = (
            update(models.UserUsage)
            .where(models.UserUsage.user_uuid == user.uuid)
            .values(
                number_copilot_calls_day_count=new_calls,
                number_copilot_tokens_day_count=models.UserUsage.number_copilot_tokens_day_count
                + usage.add_copilot_tokens,
            )
        )

    await db.execute(query)
    await db.commit()
    return await helpers.get_user_usage(user)


@router.get("/copilot/access", response_model=schemas.CopilotAccess)
async def get_copilot_access(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """The Copilot models and MCP tools the user may use, as their roles grant them."""
    return await app_helpers.get_user_copilot_access(db, user.uuid)


@router.post(
    "/copilot/authorize",
    response_model=schemas.CopilotAuthorizeResult,
    dependencies=[Depends(auth_helpers.check_metering)],
)
async def post_copilot_authorize(
    request: schemas.CopilotAuthorize,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True, agent=True)),
):
    """Check a Copilot request against what the user may use.

    The service that serves the Copilot calls this before it runs a query, with the
    user's agent token and the metering token (see `auth_helpers.check_metering`). The
    browser only hides what a user may not use, this is what enforces it. The answer to an
    agent token also carries the user's own provider keys, which the browser never sees.
    """
    access = await app_helpers.get_user_copilot_access(db, user.uuid)
    result = app_helpers.check_copilot_access(access, request)
    if user.via_agent:
        result = result.model_copy(
            update={
                "provider_keys": await app_helpers.get_copilot_provider_keys(
                    db, user.uuid
                )
            }
        )
    return result


@router.get("/usage", response_model=schemas.UsageGet)
async def get_usage(
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    result = await schemas.UsageGet.check_cache(db, user)
    if not result:
        raise HTTPException(status_code=404, detail="Usage not found")
    return result


@router.get(
    "/widget-metadata",
    response_model=list[schemas.WidgetMetadataResponse],
)
async def get_widget_metadata(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    widget_type: schemas.MetaDataWidgetType | None = None,
    name: str | None = None,
    widget_id: UUID | None = None,
):
    """
    Retrieve widget metadata for a specific widget type and name.

    Args:
        widget_type (str): The type of the widget.
        name (str): The name of the widget.
        id (UUID): The ID of the widget.
    Returns:
        List[schemas.WidgetMetadataResponse]: A list of widget metadata responses.

    Raises:
        HTTPException: If no widget metadata is found.
    """
    result = await app_helpers.get_widget_metadata(
        db=db, user=user, widget_id=widget_id, widget_type=widget_type, name=name
    )

    if not result:
        raise HTTPException(
            status_code=404, detail="Widget metadata not found for the user"
        )
    return result


@router.post("/widget-metadata", response_model=SuccessReturn)
async def post_widget_metadata(
    widget_metadata: schemas.WidgetMetadataResponse,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Create a new widget metadata entry.

    Args:
        widget_metadata (schemas.WidgetMetadataResponse): The widget metadata to be created.

    Returns:
        schemas.SuccessReturn: A success response indicating the operation was successful.
    """
    query = insert(models.WidgetMetadata).values(
        user_uuid=user.uuid, **widget_metadata.model_dump()
    )
    await db.execute(query)
    await db.commit()
    return SuccessReturn.success_instance()


@router.patch("/widget-metadata", response_model=SuccessReturn)
async def patch_widget_metadata(
    widget_metadata: schemas.WidgetMetadataResponsePatch,
    widget_id: UUID,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Update an existing widget metadata entry.

    Args:
        widget_metadata (schemas.WidgetMetadataResponse): The widget metadata to be updated.
        widget_id (UUID): The ID of the widget whose metadata is updated.
        db (AsyncSession): The database session.
        user (User): The authenticated user.

    Returns:
        schemas.SuccessReturn: A success response indicating the operation was successful.
    """
    query = (
        update(models.WidgetMetadata)
        .where(
            models.WidgetMetadata.user_uuid == user.uuid,
            models.WidgetMetadata.widget_id == widget_id,
        )
        .values(**widget_metadata.model_dump(exclude_unset=True))
    )

    if (await db.execute(query)).rowcount == 0:
        raise HTTPException(
            status_code=404, detail="Widget metadata not found for the user"
        )

    await db.commit()
    return SuccessReturn.success_instance()


@router.delete(
    "/widget-metadata/{widget_id}", response_model=list[schemas.WidgetMetadataResponse]
)
async def delete_widget_metadata(
    widget_id: UUID,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Delete an existing widget metadata entry and return the list of remaining entries.

    Args:
        widget_id (UUID): The ID of the widget to delete.
        db (AsyncSession): The database session.
        user (User): The authenticated user.

    Returns:
        List[schemas.WidgetMetadataResponse]: A list of remaining widget metadata entries.

    Raises:
        HTTPException: If no matching widget metadata is found.
    """
    delete_query = delete(models.WidgetMetadata).where(
        models.WidgetMetadata.user_uuid == user.uuid,
        models.WidgetMetadata.widget_id == widget_id,
    )

    result = await db.execute(delete_query)

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404, detail="Widget metadata not found for the given widget_id"
        )

    await db.commit()

    # Fetch remaining widget metadata for the user
    return await app_helpers.get_widget_metadata(db=db, user=user)


@router.put("/custom-copilot", response_model=SuccessReturn)
async def put_custom_copilot(
    custom_copilot: schemas.CustomCopilot,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Update or insert a custom copilot for a user.
    """
    await app_helpers.check_may_add_connections(db, user.uuid)
    await app_helpers.insert_or_update_custom_copilot(db, user.uuid, custom_copilot)
    return SuccessReturn.success_instance()


@router.get("/custom-copilot", response_model=list[schemas.CustomCopilot])
async def get_custom_copilot(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Get all custom copilots for a user.
    """
    return await app_helpers.get_custom_copilots(db, user.uuid)


@router.delete("/custom-copilot/{uuid}", response_model=SuccessReturn)
async def delete_custom_copilot(
    uuid: UUID,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Delete a custom copilot(s) for a user.
    If the url is provided, delete only that copilot, otherwise delete all custom copilots for the user.
    """
    await app_helpers.delete_custom_copilot(db, user.uuid, uuid)
    return SuccessReturn.success_instance()


@router.post("/prompts", response_model=SuccessReturn)
async def post_user_prompt(
    prompts: list[schemas.Prompt],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Add the user prompts state.
    """
    await app_helpers.insert_user_prompt_state(db, user.uuid, prompts)
    return SuccessReturn.success_instance()


@router.get("/prompts", response_model=list[schemas.Prompt])
async def get_user_prompt(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Get the user prompts state.
    """
    return await app_helpers.get_user_prompt_state(db, user.uuid)


@router.post("/skills", response_model=list[schemas.SkillReturn])
async def create_user_skill(
    skill: schemas.SkillCreate,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Add the user skills state.
    """
    query = insert(models.UserSkills).values(**skill.model_dump(), user_uuid=user.uuid)
    await db.execute(query)
    await db.commit()
    return await app_helpers.get_user_skill_state(db, user.uuid)


@router.patch("/skills/{skill_uuid}", response_model=list[schemas.SkillReturn])
async def update_user_skill(
    skill_uuid: UUID,
    skill: schemas.SkillCreate,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Update a user skill.
    """
    await app_helpers.update_user_skill(db, user.uuid, skill_uuid, skill)
    return await app_helpers.get_user_skill_state(db, user.uuid)


@router.delete("/skills", response_model=list[schemas.SkillReturn])
async def delete_user_skill(
    skill_uuids: list[UUID],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Delete a user skill.
    """
    await app_helpers.delete_user_skills(db, user.uuid, skill_uuids)
    return await app_helpers.get_user_skill_state(db, user.uuid)


@router.get("/role-permissions", response_model=schemas.UserRolesPermissions)
async def get_user_role_permissions(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Get the role permissions for a user.
    """
    return await app_helpers.get_user_role_permissions(db, user.uuid)


@router.get(
    "/resource-permissions", response_model=schemas.UserRolesPermissionsFlattened
)
async def get_resource_permissions(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Get the resource permissions for a user.
    """
    permissions = await app_helpers.get_user_role_permissions(db, user.uuid)
    return app_helpers.flatten_permissions(permissions.model_dump())


@router.get("/theme-settings", response_model=schemas.EntityThemeSettings)
async def get_theme_settings(
    db: AsyncSession = Depends(aget_read_db),
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """Get the theme settings for the entity"""
    entity_uuid = await app_helpers.get_entity_uuid(db, user.uuid)
    return await app_helpers.get_entity_theme_settings(db, entity_uuid)


@router.post("/mcp-servers", response_model=schemas.MCPServers)
async def post_mcp_servers(
    mcp_servers: schemas.MCPServers,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    """Save the user's MCP servers.

    Custom header values are write-only: a value sets the header, null removes it, a
    header left out keeps its stored value. They are stored encrypted apart from the
    server list, and the answer names each server's headers without their values.
    """
    await app_helpers.check_may_add_connections(db, user.uuid)
    await app_helpers.save_mcp_servers(db, user.uuid, mcp_servers.servers)
    return await app_helpers.get_mcp_servers(db, user)


# The hosts of MCP servers on the user's own machine, which the browser reaches directly
LOCAL_MCP_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


@router.post("/mcp-servers/local-headers", response_model=schemas.MCPServerHeaders)
async def get_local_mcp_server_headers(
    payload: schemas.MCPLocalServer,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(mcp_oauth.web_user),
):
    """The stored headers of the user's saved MCP server at this local URL (in the body).

    The browser connects to a server on the user's machine itself and keeps these in
    memory for the connection. For any other server the API adds the headers to the
    requests it proxies, and their values never reach the browser. Served to the web app
    only (its session cookie), never to a bearer session.
    """
    if urlparse(payload.url.strip()).hostname not in LOCAL_MCP_HOSTS:
        raise HTTPException(400, detail="Only the headers of a local server are served")
    await app_helpers.check_may_add_connections(db, user.uuid)
    headers = await app_helpers.get_mcp_server_headers(db, user.uuid, payload.url)
    if headers is None:
        raise HTTPException(404, detail="No MCP server is saved at this URL")
    return schemas.MCPServerHeaders(headers=headers)


@router.get("/copilot-keys", response_model=schemas.CopilotKeysStatus)
async def get_copilot_keys(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """Which of the user's own Copilot provider keys are stored; never their values."""
    return await app_helpers.get_copilot_key_status(db, user.uuid)


@router.put("/copilot-keys", response_model=schemas.CopilotKeysStatus)
async def put_copilot_keys(
    keys: schemas.CopilotProviderKeys,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """Store the user's own Copilot provider keys, encrypted: a key sets it, null clears
    it, a key left out stays. The keys reach the default Copilot through
    /copilot/authorize, never through the browser."""
    await app_helpers.set_copilot_provider_keys(db, user.uuid, keys)
    return await app_helpers.get_copilot_key_status(db, user.uuid)


# The headers of the browser's MCP requests that reach the server: the protocol's own.
# Credentials come from what the API keeps for the server, never from the browser.
MCP_REQUEST_HEADERS = frozenset(
    {"accept", "content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id"}
)
# The headers of the server's answers that reach the browser
MCP_RESPONSE_HEADERS = (
    "content-type",
    "cache-control",
    "mcp-session-id",
    "www-authenticate",
    "mcp-protocol-version",
)
# The ones of them the web app reads, on its requests to another origin (the API's)
MCP_EXPOSED_HEADERS = "mcp-session-id, mcp-protocol-version, www-authenticate"


# How long the messages endpoint an SSE server announced takes the server's credentials
SSE_ENDPOINT_LIFETIME = timedelta(hours=24)
# How much of an SSE stream is read for its first event, where the endpoint is announced
SSE_ANNOUNCEMENT_MAX_BYTES = 16 * 1024


def on_mcp_origin(server_url: str, url: str) -> bool:
    """Whether `url` is on the host of the MCP server at `server_url`: the same scheme,
    host and port, and a path without "." or ".." segments."""
    try:
        server = httpx.URL(schemas.normalize_mcp_url(server_url))
        target = httpx.URL(url)
    except httpx.InvalidURL:
        return False
    if (target.scheme, target.host, target.port) != (server.scheme, server.host, server.port):
        return False
    return not {".", ".."} & set(target.path.split("/"))


def under_mcp_server_path(server_url: str, url: str) -> bool:
    """Whether the path of `url` is the saved server's path or under it (the server's
    credentials are bound to that path as a prefix). Both are on the same origin."""
    prefix = httpx.URL(schemas.normalize_mcp_url(server_url)).path.rstrip("/")
    path = httpx.URL(url).path
    return path == prefix or path.startswith(f"{prefix}/")


def _canonical_url(url: str | httpx.URL) -> str:
    return str(httpx.URL(url).copy_with(fragment=None))


def _sse_endpoint_key(user_uuid: UUID, server: str, endpoint: str) -> str:
    # Hashes only: the endpoint's query names the server's session
    return auth_helpers.app_redis_key(
        f"mcp_sse_endpoint:{user_uuid}:{crypto.hash_token(server)}:"
        f"{crypto.hash_token(_canonical_url(endpoint))}"
    )


async def _record_sse_endpoint(
    user_uuid: UUID, server: str, stream_url: str, announced: str
) -> None:
    """Keep the messages endpoint that an SSE server announced on a stream the user
    opened (the legacy SSE transport), so that the user's requests to it, beside the
    server's own path, take the server's credentials."""
    try:
        endpoint = httpx.URL(stream_url).join(announced.strip())
    except httpx.InvalidURL:
        return
    if not on_mcp_origin(server, str(endpoint)):
        return
    async with auth_helpers.app_redis() as redis:
        await redis.set(
            _sse_endpoint_key(user_uuid, server, str(endpoint)),
            1,
            ex=int(SSE_ENDPOINT_LIFETIME.total_seconds()),
        )


async def _announced_by_server(user_uuid: UUID, server: str, url: str) -> bool:
    async with auth_helpers.app_redis() as redis:
        return bool(await redis.exists(_sse_endpoint_key(user_uuid, server, url)))


def _first_sse_event(start: bytes) -> dict[str, str] | None:
    """The event and data of the first event in the start of an SSE stream, or None
    while no event is complete. Comments and empty blocks dispatch no event."""
    text = start.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    *blocks, _incomplete = text.split("\n\n")
    for block in blocks:
        fields: dict[str, str] = {}
        for line in block.split("\n"):
            name, _, value = line.partition(":")
            value = value.removeprefix(" ")
            if name == "data":
                fields["data"] = f"{fields['data']}\n{value}" if "data" in fields else value
            elif name == "event":
                fields["event"] = value
        if "data" in fields:
            return fields
    return None


async def _watch_sse_announcement(
    chunks: AsyncIterator[bytes], record: Callable[[str], Awaitable[None]]
) -> AsyncIterator[bytes]:
    """Pass an SSE stream through, recording the endpoint its first event announces
    before that event reaches the browser."""
    start: bytes | None = b""
    async for chunk in chunks:
        if start is not None:
            start += chunk
            event = _first_sse_event(start)
            if event is not None:
                if event.get("event") == "endpoint":
                    await record(event["data"])
                start = None
            elif len(start) > SSE_ANNOUNCEMENT_MAX_BYTES:
                start = None
        yield chunk


class MCPProxyRequest(BaseModel):
    """A request of the web app's MCP client: `server_url` names the server (the URL it is
    saved under, compared normalized), and `url` is where the request goes, on that server."""

    model_config = {"extra": "ignore"}

    server_url: str = Field(max_length=2048)
    url: str = Field(max_length=8192)
    method: Literal["GET", "POST"] = "GET"
    headers: dict[str, str] | None = None
    body: dict | list | None = None

    @field_validator("server_url", "url")
    @classmethod
    def check_web_url(cls, value: str) -> str:
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Must be an http or https URL")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Must not carry credentials")
        return value

    @model_validator(mode="after")
    def check_on_server(self) -> "MCPProxyRequest":
        if not on_mcp_origin(self.server_url, self.url):
            raise ValueError("The request must go to the MCP server it names")
        return self


async def check_own_mcp_server(db: AsyncSession, user_uuid: UUID, url: str) -> None:
    """Refuse users who may not bring connections the MCP servers they added."""
    if await app_helpers.may_add_connections(db, user_uuid):
        return

    query = (
        select(models.MCPServers.servers)
        .where(models.MCPServers.user_uuid == user_uuid)
        .limit(1)
    )
    own_servers = schemas.MCPServers(
        servers=(await db.execute(query)).scalar_one_or_none() or []
    ).servers
    target = schemas.normalize_mcp_url(url)
    if any(schemas.normalize_mcp_url(server.url) == target for server in own_servers):
        raise HTTPException(
            status_code=403, detail="Your account type cannot add connections"
        )


async def check_mcp_tool_calls(
    db: AsyncSession, user_uuid: UUID, data: MCPProxyRequest
) -> None:
    """Refuse the tool calls in a proxied request that the user's roles do not grant on
    the server it names."""
    calls = data.body if isinstance(data.body, list) else [data.body]
    tool_names = [
        call["params"]["name"]
        for call in calls
        if isinstance(call, dict)
        and call.get("method") == "tools/call"
        and isinstance(call.get("params"), dict)
        and isinstance(call["params"].get("name"), str)
    ]
    if not tool_names:
        return

    access = await app_helpers.get_user_copilot_access(db, user_uuid)
    for name in tool_names:
        if not app_helpers.is_mcp_tool_allowed(access, data.server_url, name):
            raise HTTPException(
                status_code=403, detail=f"You do not have access to the tool `{name}`"
            )


async def _send_to_mcp_server(
    data: MCPProxyRequest, stored_headers: dict[str, str], authorization: str | None
) -> httpx.Response:
    """Sends the browser's request with the protocol headers it carries, the headers the
    user stored for the server and the Authorization of their sign-in."""
    headers = httpx.Headers(
        {
            name: value
            for name, value in (data.headers or {}).items()
            if name.lower() in MCP_REQUEST_HEADERS
        }
    )
    for name, value in stored_headers.items():
        headers[name] = value
    if authorization is not None:
        headers["Authorization"] = authorization
    request = mcp_oauth.mcp_http.build_request(
        data.method, data.url, headers=headers, json=data.body
    )
    return await mcp_oauth.mcp_http.send(request, stream=True, follow_redirects=False)


async def _mcp_answer(
    response: httpx.Response,
    server: str,
    record_endpoint: Callable[[str], Awaitable[None]] | None = None,
) -> Response:
    """The server's answer as the browser gets it: its status, body and allowed headers.
    A refusal of credentials asks the web app to sign the user in. With `record_endpoint`,
    the messages endpoint that an event stream announces is recorded."""
    if response.status_code == status.HTTP_401_UNAUTHORIZED:
        await response.aclose()
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"auth_required": True, "server_url": server},
        )
    if httpx.codes.is_redirect(response.status_code):
        await response.aclose()
        raise HTTPException(
            status_code=502, detail="The MCP server answered with a redirect, not followed"
        )
    headers = {
        name: response.headers[name]
        for name in MCP_RESPONSE_HEADERS
        if name in response.headers
    }
    headers["Access-Control-Expose-Headers"] = MCP_EXPOSED_HEADERS
    content = response.aiter_bytes()
    if (
        record_endpoint is not None
        and response.status_code == status.HTTP_200_OK
        and response.headers.get("content-type", "").startswith("text/event-stream")
    ):
        content = _watch_sse_announcement(content, record_endpoint)
    return StreamingResponse(
        content=content,
        status_code=response.status_code,
        headers=headers,
        background=BackgroundTask(response.aclose),
    )


@router.post("/mcp-proxy", response_class=StreamingResponse)
async def mcp_proxy(
    data: Annotated[MCPProxyRequest, Body()],
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(mcp_oauth.web_user),
):
    """Send a request of the web app's MCP client to a remote MCP server.

    The request names the server by the URL it is saved under and goes to that server only:
    its scheme, host and port, and its path or a path under it. The one other path is the
    messages endpoint that the server announced on an event stream the user opened through
    here (the SSE transport). The API adds what it keeps for the server: the user's stored
    headers, and the access token of their sign-in, refreshed when it has expired or the
    server refuses it. The browser's own headers reach the server only as far as the
    protocol needs them. The server must be on the public internet (or one of
    ALLOWED_MCP_HOSTNAMES or DEFAULT_MCP_SERVERS), redirects are not followed, and only
    the protocol's headers of the answer reach the browser. When the server wants credentials the user has not
    given, the answer is 401 with `auth_required` and the server's URL. Tool calls are
    limited to the tools the user's roles grant. Only the web app reaches it, by its
    session cookie.
    """
    server = schemas.normalize_mcp_url(data.server_url)
    if not under_mcp_server_path(server, data.url) and not (
        data.method == "POST" and await _announced_by_server(user.uuid, server, data.url)
    ):
        raise HTTPException(
            status_code=422, detail="The request must go to the MCP server it names"
        )
    for url in (server, data.url):
        await check_own_mcp_server(db, user.uuid, url)
    await check_mcp_tool_calls(db, user.uuid, data)

    stored_headers = await app_helpers.get_mcp_server_headers(db, user.uuid, server) or {}
    # A server with a stored token (token auth) takes no sign-in
    token_auth = any(name.lower() == "authorization" for name in stored_headers)
    try:
        authorization = (
            None if token_auth else await mcp_oauth.grant_authorization(user.uuid, server)
        )
        response = await _send_to_mcp_server(data, stored_headers, authorization)
        if response.status_code == status.HTTP_401_UNAUTHORIZED and authorization:
            await response.aclose()
            authorization = await mcp_oauth.grant_authorization(
                user.uuid, server, refused=authorization
            )
            if authorization is not None:
                response = await _send_to_mcp_server(data, stored_headers, authorization)
    except mcp_oauth.BlockedAddressError as e:
        raise HTTPException(
            status_code=403, detail=f"The MCP server may not be reached: {e}"
        ) from e
    except httpx.TimeoutException as e:
        raise HTTPException(
            status_code=504, detail="MCP service request timed out"
        ) from e
    except httpx.HTTPError as e:
        # The host only: a server's path or query may carry a credential
        logger.error(
            f"An error occurred while requesting the MCP server at "
            f"{urlsplit(server).hostname}: {type(e).__name__}"
        )
        raise HTTPException(
            status_code=502, detail="Error connecting to MCP service"
        ) from e

    async def record_endpoint(announced: str) -> None:
        await _record_sse_endpoint(user.uuid, server, data.url, announced)

    return await _mcp_answer(
        response, server, record_endpoint if data.method == "GET" else None
    )
