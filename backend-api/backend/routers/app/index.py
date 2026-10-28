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
from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request, status
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


@router.post(
    "/logout",
    response_model=SuccessReturn,
    summary="Sign out",
    description=(
        "Ends the web app sessions of the signed-in user, revokes the user's agent tokens, and clears the session "
        "cookie. The route answers success even when no session was open. It allows only a few requests a minute for "
        "each client address."
    ),
)
@limiter.limit("10/minute", exempt_when=exempt_service_token)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(aget_write_db),
):
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


@router.post(
    "/login",
    response_model=schemas.AppTokenWithContext,
    summary="Sign in with an email and a password",
    description=(
        "Checks the email, the password and, when the user has an active authenticator, the code in `totp_token`, then "
        "starts a session in the cookie `__Host-ws_session` and returns the user's app token with the data that the web "
        "app needs at start. Answers 202 with `two_factor_required` when the user must set up two-factor authentication "
        "first, and 202 with the message `Invalid TOTP token` when the code is missing or wrong. Answers 401 when the "
        "credentials are wrong, 403 when the user is not confirmed, and 400 without the header `X-Workspace-Client: "
        "web`. It allows only a few attempts a minute for each client address."
    ),
)
@limiter.limit("5/minute", exempt_when=exempt_service_token)
async def login(
    request: Request,
    response: Response,
    user: schemas.AppUserLogin,
    db: AsyncSession = Depends(aget_write_db),
):
    source = user.source or "app"
    auth_helpers.check_browser_sign_in(request)

    if not (
        result := (await db.execute(helpers.get_app_user_query(user.email))).first()
    ):
        raise EXCEPTION_401

    if not result._asdict().get("permissions_uuid", None):
        raise EXCEPTION_401

    db_user = schemas.AppUserSchema.model_validate(result)
    app_helpers.check_login(user, db_user)

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

    is_first_login = await helpers.check_first_login(
        db, db_user.uuid, ["oauth-app", "app"]
    )

    helpers.handle_add_login(db_user.uuid, source)

    chats = await app_helpers.get_copilot_chats(db, db_user.uuid)
    questions_history = await app_helpers.get_user_questions_history(db, db_user.uuid)

    mcp_servers = await app_helpers.get_mcp_servers(db, db_user)

    entity_theme_settings = await app_helpers.get_entity_theme_settings(
        db, db_user.entity_uuid
    )

    dashboards_complete = await app_helpers.get_dashboards_complete(db_user)

    user_apps_complete = await app_helpers.get_user_apps_complete(db_user)

    curr_user = await auth_helpers.generate_user_query(
        auth_helpers.session_filters(
            auth_helpers.Credential("web", access_token)
        ),
        auth_helpers.CURRENT_APP_USER["columns"],
        auth_helpers.CURRENT_APP_USER["tables"],
    )

    if access.user_type == models.ADMIN_TYPE and db_user.entity_uuid is not None:
        entity_query = select(models.ApiSource).where(
            models.ApiSource.entity_uuid == db_user.entity_uuid
        )
        entity_backends = (await db.execute(entity_query)).scalars().all()
        if entity_backends and isinstance(curr_user.ApiSource, list):
            curr_user.ApiSource.extend(entity_backends)

    widget_metadata = await app_helpers.get_widget_metadata(db=db, user=db_user)
    user_data = await app_helpers.set_app_user_data(curr_user, db)
    user_data.widget_metadata = widget_metadata

    usage = await helpers.get_user_usage(db_user)

    custom_copilots = await app_helpers.get_custom_copilots(db, db_user.uuid)

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
        await db.execute(
            update(User)
            .where(User.uuid == account["uuid"])
            .values(microsoft_id=identity.microsoft_id)
        )
        await db.commit()
    return answer


@router.post(
    "/reset-password",
    response_model=SuccessReturn,
    summary="Choose a new password with a reset link",
    description=(
        "Uses the token of a password reset link, which works once, to set a new password, clears the "
        "temporary-password flag, and ends every session of the user. Answers 400 when the link has expired or was used "
        "already, or when the request lacks the header `X-Workspace-Client: web`."
    ),
)
@limiter.limit(LIMIT_FEW)
async def post_reset_password(
    request: Request,
    reset: schemas.PasswordReset,
    db: AsyncSession = Depends(aget_write_db),
):
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


@router.post(
    "/sign-in/nonce",
    response_model=schemas.SignInNonce,
    summary="Get a nonce for signing in with a provider",
    description=(
        "Issues a nonce for a Microsoft or Okta sign-in, sets it in a cookie, and returns it in the field `nonce`. The "
        "provider's token must carry the nonce's hash. Answers 400 without the header `X-Workspace-Client: web`."
    ),
)
@limiter.limit(LIMIT_FEW)
async def post_sign_in_nonce(request: Request, response: Response):
    auth_helpers.check_browser_sign_in(request)
    return schemas.SignInNonce(
        nonce=await sign_in_providers.issue_sign_in_nonce(response)
    )


@router.post(
    "/{provider}-auth",
    response_model=schemas.AppTokenWithContext,
    summary="Sign in with Google, Microsoft or Okta",
    description=(
        "Verifies the provider's token, finds the user by the verified email, or creates the user from the default user "
        "mapping when the email has none, and then signs the user in like `POST /app/login`, without a password. "
        "Answers 403 when Microsoft has not verified the email, 400 when the account cannot be created or the request "
        "lacks the header `X-Workspace-Client: web`, and the same statuses as `POST /app/login`. It allows only a few "
        "attempts a minute for each client address."
    ),
)
@limiter.limit("5/minute")
async def oauth_auth(
    request: Request,
    response: Response,
    provider: Annotated[
        Literal["google", "microsoft", "okta"], Path(description="The sign-in provider: `google`, `microsoft` or `okta`.")
    ],
    data: schemas.AuthData,
    db: AsyncSession = Depends(aget_write_db),
):
    auth_helpers.check_browser_sign_in(request)
    if provider == "google":
        identity = await sign_in_providers.google_identity(data.token)
        return await handle_oauth_user(request, response, db, identity, data)

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


@router.get(
    "/2fa",
    response_model=schemas.TwoFactorAuthGet,
    summary="Get the user's two-factor settings",
    description=(
        "Returns whether two-factor authentication is on for the signed-in user, which needs an active authenticator, "
        "and whether the user's organization requires it."
    ),
)
async def get_2fa(
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(
        auth_helpers.GetCurrentUser(
            ["uuid", "two_factor_auth", "totp_active"], app_session=True
        )
    ),
):
    entity_uuid = await app_helpers.get_entity_uuid(db, user.uuid)
    entity_require_authenticator = await app_helpers.entity_require_authenticator(
        db, entity_uuid
    )

    two_factor_auth = user.two_factor_auth or entity_require_authenticator

    return schemas.TwoFactorAuthGet(
        two_factor_auth=two_factor_auth and user.totp_active,
        entity_require_authenticator=entity_require_authenticator,
    )


@router.put(
    "/2fa",
    response_model=SuccessReturn,
    summary="Turn the user's two-factor authentication on or off",
    description=(
        "Sets the user's own two-factor setting and removes the user's authenticator, so that the user sets it up again "
        "with `POST /totp`."
    ),
)
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


@router.get(
    "/user",
    response_model=schemas.AppUserReturn,
    summary="Get the signed-in user",
    description=(
        "Returns the signed-in user's name, display settings, file widgets, backends and widget metadata. The Copilot "
        "agent can call it with a bearer token that it got from `POST /app/copilot/token`, and then the answer holds "
        "only the user's identity and display settings."
    ),
)
async def get_user(
    db: AsyncSession = Depends(aget_read_db),
    user=Depends(auth_helpers.GetCurrentUser(**auth_helpers.CURRENT_APP_USER, agent=True)),
):
    if user.via_agent:
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


@router.get(
    "/validate",
    response_model=SuccessReturn,
    summary="Check whether a session is open",
    description=(
        "Answers `success` true when the request carries a valid web app session, and `success` false when it does not. "
        "It never answers with an error status."
    ),
)
async def validate_user(request: Request):
    try:
        await auth_helpers.GetCurrentUser(["uuid"], app_session=True)(request)
    except HTTPException:
        return SuccessReturn.failure_instance()
    return SuccessReturn.success_instance()


@router.get(
    "/session",
    response_model=schemas.AppSession,
    summary="Get the current session",
    description=(
        "Returns the session of the signed-in user: the email, the expiry, whether the password is temporary, whether "
        "the user must set up two-factor authentication, the organization's name, the user's type and access, usage and "
        "the state of the user's own Copilot keys. Answers 401 without the header `X-Workspace-Client: web`."
    ),
)
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


@router.post(
    "/copilot/token",
    response_model=schemas.AgentToken,
    summary="Get a token for the Copilot agent",
    description=(
        "Mints a short-lived bearer token that lets the Copilot agent call the API as the signed-in user, and returns "
        "it with its lifetime in seconds in `expires_in`. A sign-out revokes it. Answers 401 without the header "
        "`X-Workspace-Client: web`."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def post_copilot_token(
    request: Request,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    if request.headers.get(auth_helpers.CLIENT_HEADER) != auth_helpers.WEB_CLIENT:
        raise auth_helpers.credentials_exception
    token, lifetime = await auth_helpers.mint_agent_token(user)
    return schemas.AgentToken(token=token, expires_in=lifetime)


@router.get(
    "/access",
    response_model=schemas.UserAccess,
    summary="Get the user's type and sharing level",
    description="Returns the user's type, Admin, Developer or User, and the sharing level that the user's roles allow.",
)
async def get_access(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    return await app_helpers.get_user_access(db, user.uuid)


@router.post(
    "/display-settings",
    response_model=SuccessReturn,
    summary="Save the user's display settings",
    description="Replaces the display settings of the signed-in user with the object in the request.",
)
async def post_display_settings(
    payload: schemas.UserDisplaySettings,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    query = (
        update(User).where(User.uuid == user.uuid).values(display_settings=payload)
    )
    await db.execute(query)
    await db.commit()
    return SuccessReturn.success_instance()


@router.post(
    "/copilot-chats",
    response_model=schemas.UsageGet,
    summary="Save the user's Copilot chats",
    description=(
        "Creates and updates the user's Copilot chats in one request and returns the user's usage. Answers 400 when the "
        "database rejects the change."
    ),
)
async def post_copilot_chats(
    chats: schemas.CopilotChatsCreate,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    try:
        await crud.bulk_copilot_chats_insert_update(db, user.uuid, chats)
    except SQLAlchemyError as e:
        logger.error(e)
        await db.rollback()
        raise HTTPException(
            status_code=400, detail="Could not successfully update the items"
        ) from e

    return await schemas.UsageGet.check_cache(db, user)


@router.delete(
    "/copilot-chats",
    response_model=SuccessReturn,
    summary="Delete all of the user's Copilot chats",
    description="Deletes every Copilot chat of the signed-in user.",
)
async def delete_copilot_chats(
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    query = delete(models.CopilotChat).where(
        models.CopilotChat.user_uuid == user.uuid,
    )
    await db.execute(query)
    await db.commit()
    return SuccessReturn.success_instance()


@router.get(
    "/copilot-chats/search",
    response_model=list[schemas.Chat | schemas.ChatInfo],
    summary="Search the user's Copilot chats",
    description=(
        "Returns the user's chats whose content matches `query`, which needs at least two characters. The optional "
        "`start_date` and `end_date` limit the search to a time range."
    ),
)
async def search_copilot_chats(
    query: Annotated[
        str, Query(..., min_length=2, description="The text to look for. It needs at least two characters.")
    ],
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    start_date: Annotated[
        dateType | datetime | None, Query(description="Search only chats from this date or later.")
    ] = None,
    end_date: Annotated[dateType | datetime | None, Query(description="Search only chats up to this date.")] = None,
):
    return await crud.search_copilot_chats(db, user.uuid, query, start_date, end_date)


@router.get(
    "/copilot-chats/{chat_uuid}",
    response_model=schemas.Chat,
    summary="Get a Copilot chat",
    description=(
        "Returns one of the user's chats with its messages and records that the user has just opened it. Answers 404 "
        "when the user has no chat with that UUID."
    ),
)
async def get_copilot_chat(
    chat_uuid: Annotated[UUID, Path(description="The UUID of the Copilot chat.")],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
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
    summary="Report Copilot usage for a user",
    description=(
        "Adds to, subtracts from or resets the user's Copilot call and token counts for the day, and returns the new "
        "usage. When an addition would pass the user's limit, the answer reports the limit error instead of changing "
        "the count. Only the Copilot service may call it, with the header `X-Metering-Authorization: Bearer <token>`, "
        "and the call answers 403 otherwise."
    ),
)
async def put_usage(
    usage: schemas.UsagePut,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True, agent=True)),
):
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


@router.get(
    "/copilot/access",
    response_model=schemas.CopilotAccess,
    summary="Get the user's Copilot access",
    description=(
        "Returns the Copilot models and the MCP tools that the user's roles grant, and the Copilot capabilities that "
        "the roles disable."
    ),
)
async def get_copilot_access(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    return await app_helpers.get_user_copilot_access(db, user.uuid)


@router.post(
    "/copilot/authorize",
    response_model=schemas.CopilotAuthorizeResult,
    dependencies=[Depends(auth_helpers.check_metering)],
    summary="Check the user's access to a model and tools",
    description=(
        "Reports whether the user's roles allow the agent, the model and the MCP tools in the request, and names the "
        "denied model and tools when they do not. Called with the agent's bearer token, the answer also carries the "
        "user's own provider keys. Only the Copilot service may call it, with the header `X-Metering-Authorization: "
        "Bearer <token>`, and the call answers 403 otherwise."
    ),
)
async def post_copilot_authorize(
    request: schemas.CopilotAuthorize,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True, agent=True)),
):
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


@router.get(
    "/usage",
    response_model=schemas.UsageGet,
    summary="Get the user's Copilot usage",
    description=(
        "Returns the user's Copilot calls and tokens for the day with the limits that the user's roles set, and the "
        "user's file storage use. Answers 404 when there is no usage."
    ),
)
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
    summary="List the user's widget metadata",
    description=(
        "Returns the metadata that the user saved for widgets. The optional parameters `widget_type`, `name` and "
        "`widget_id` narrow the list. Answers 404 when nothing matches."
    ),
)
async def get_widget_metadata(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    widget_type: Annotated[
        schemas.MetaDataWidgetType | None, Query(description="Return only the metadata of widgets of this type.")
    ] = None,
    name: Annotated[str | None, Query(description="Return only the metadata of the widget with this name.")] = None,
    widget_id: Annotated[UUID | None, Query(description="Return only the metadata of the widget with this id.")] = None,
):
    result = await app_helpers.get_widget_metadata(
        db=db, user=user, widget_id=widget_id, widget_type=widget_type, name=name
    )

    if not result:
        raise HTTPException(
            status_code=404, detail="Widget metadata not found for the user"
        )
    return result


@router.post(
    "/widget-metadata",
    response_model=SuccessReturn,
    summary="Save widget metadata",
    description="Stores the metadata of one widget for the signed-in user.",
)
async def post_widget_metadata(
    widget_metadata: schemas.WidgetMetadataResponse,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    query = insert(models.WidgetMetadata).values(
        user_uuid=user.uuid, **widget_metadata.model_dump()
    )
    await db.execute(query)
    await db.commit()
    return SuccessReturn.success_instance()


@router.patch(
    "/widget-metadata",
    response_model=SuccessReturn,
    summary="Change widget metadata",
    description=(
        "Changes the fields that the request names in the metadata of the widget whose id is in `widget_id`. Answers "
        "404 when the user has no metadata for that widget."
    ),
)
async def patch_widget_metadata(
    widget_metadata: schemas.WidgetMetadataResponsePatch,
    widget_id: Annotated[UUID, Query(description="The id of the widget whose metadata changes.")],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
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
    "/widget-metadata/{widget_id}",
    response_model=list[schemas.WidgetMetadataResponse],
    summary="Delete widget metadata",
    description=(
        "Deletes the user's metadata for the widget and returns the metadata that remains. Answers 404 when the user "
        "has none for that widget."
    ),
)
async def delete_widget_metadata(
    widget_id: Annotated[UUID, Path(description="The id of the widget whose metadata to delete.")],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
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

    return await app_helpers.get_widget_metadata(db=db, user=user)


@router.put(
    "/custom-copilot",
    response_model=SuccessReturn,
    summary="Create or update a custom Copilot",
    description=(
        "Saves a custom Copilot of the signed-in user: it creates the Copilot, or replaces the user's Copilot with the "
        "same id. Answers 403 when the user's type may not add connections."
    ),
)
async def put_custom_copilot(
    custom_copilot: schemas.CustomCopilot,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    await app_helpers.check_may_add_connections(db, user.uuid)
    await app_helpers.insert_or_update_custom_copilot(db, user.uuid, custom_copilot)
    return SuccessReturn.success_instance()


@router.get(
    "/custom-copilot",
    response_model=list[schemas.CustomCopilot],
    summary="List the user's custom Copilots",
    description="Returns the custom Copilots that the signed-in user saved.",
)
async def get_custom_copilot(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    return await app_helpers.get_custom_copilots(db, user.uuid)


@router.delete(
    "/custom-copilot/{uuid}",
    response_model=SuccessReturn,
    summary="Delete a custom Copilot",
    description="Deletes the user's custom Copilot with that UUID.",
)
async def delete_custom_copilot(
    uuid: Annotated[UUID, Path(description="The UUID of the custom Copilot.")],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    await app_helpers.delete_custom_copilot(db, user.uuid, uuid)
    return SuccessReturn.success_instance()


@router.post(
    "/prompts",
    response_model=SuccessReturn,
    summary="Save the user's prompts",
    description=(
        "Makes the list in the request the user's prompts: it adds new ones, updates existing ones and deletes the "
        "user's prompts that the list leaves out."
    ),
)
async def post_user_prompt(
    prompts: list[schemas.Prompt],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    await app_helpers.insert_user_prompt_state(db, user.uuid, prompts)
    return SuccessReturn.success_instance()


@router.get(
    "/prompts",
    response_model=list[schemas.Prompt],
    summary="List the user's prompts",
    description="Returns the prompts that the signed-in user saved.",
)
async def get_user_prompt(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    return await app_helpers.get_user_prompt_state(db, user.uuid)


@router.post(
    "/skills",
    response_model=list[schemas.SkillReturn],
    summary="Create a skill",
    description="Adds a skill for the signed-in user and returns all of the user's skills.",
)
async def create_user_skill(
    skill: schemas.SkillCreate,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    query = insert(models.UserSkills).values(**skill.model_dump(), user_uuid=user.uuid)
    await db.execute(query)
    await db.commit()
    return await app_helpers.get_user_skill_state(db, user.uuid)


@router.patch(
    "/skills/{skill_uuid}",
    response_model=list[schemas.SkillReturn],
    summary="Change a skill",
    description="Replaces the content of the user's skill with that UUID and returns all of the user's skills.",
)
async def update_user_skill(
    skill_uuid: Annotated[UUID, Path(description="The UUID of the skill.")],
    skill: schemas.SkillCreate,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    await app_helpers.update_user_skill(db, user.uuid, skill_uuid, skill)
    return await app_helpers.get_user_skill_state(db, user.uuid)


@router.delete(
    "/skills",
    response_model=list[schemas.SkillReturn],
    summary="Delete skills",
    description="Deletes the user's skills whose UUIDs are in the request and returns the skills that remain.",
)
async def delete_user_skill(
    skill_uuids: list[UUID],
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    await app_helpers.delete_user_skills(db, user.uuid, skill_uuids)
    return await app_helpers.get_user_skill_state(db, user.uuid)


@router.get(
    "/role-permissions",
    response_model=schemas.UserRolesPermissions,
    summary="List the access that the user's roles grant",
    description=(
        "Returns the data connectors, templates and prompts that each of the user's roles grants, with the access level "
        "of each."
    ),
)
async def get_user_role_permissions(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    return await app_helpers.get_user_role_permissions(db, user.uuid)


@router.get(
    "/resource-permissions",
    response_model=schemas.UserRolesPermissionsFlattened,
    summary="List the user's access to resources",
    description="Returns the access that the user's roles grant, combined across the roles and listed by resource.",
)
async def get_resource_permissions(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    permissions = await app_helpers.get_user_role_permissions(db, user.uuid)
    return app_helpers.flatten_permissions(permissions.model_dump())


@router.get(
    "/theme-settings",
    response_model=schemas.EntityThemeSettings,
    summary="Get the organization's theme settings",
    description="Returns the light and dark theme settings of the signed-in user's organization.",
)
async def get_theme_settings(
    db: AsyncSession = Depends(aget_read_db),
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    entity_uuid = await app_helpers.get_entity_uuid(db, user.uuid)
    return await app_helpers.get_entity_theme_settings(db, entity_uuid)


@router.post(
    "/mcp-servers",
    response_model=schemas.MCPServers,
    summary="Save the user's MCP servers",
    description=(
        "Replaces the user's saved MCP servers with the list in the request and returns the saved list. Answers 403 "
        "when the user's type may not add connections."
    ),
)
async def post_mcp_servers(
    mcp_servers: schemas.MCPServers,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    await app_helpers.check_may_add_connections(db, user.uuid)
    await app_helpers.save_mcp_servers(db, user.uuid, mcp_servers.servers)
    return await app_helpers.get_mcp_servers(db, user)


LOCAL_MCP_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


@router.post(
    "/mcp-servers/local-headers",
    response_model=schemas.MCPServerHeaders,
    summary="Get the headers of a local MCP server",
    description=(
        "Returns the headers that the user saved for an MCP server on `localhost`. Answers 400 when the address is not "
        "local, 403 when the user's type may not add connections, and 404 when no MCP server is saved at that address. "
        "Only the web app can call it."
    ),
)
async def get_local_mcp_server_headers(
    payload: schemas.MCPLocalServer,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(mcp_oauth.web_user),
):
    if urlparse(payload.url.strip()).hostname not in LOCAL_MCP_HOSTS:
        raise HTTPException(400, detail="Only the headers of a local server are served")
    await app_helpers.check_may_add_connections(db, user.uuid)
    headers = await app_helpers.get_mcp_server_headers(db, user.uuid, payload.url)
    if headers is None:
        raise HTTPException(404, detail="No MCP server is saved at this URL")
    return schemas.MCPServerHeaders(headers=headers)


@router.get(
    "/copilot-keys",
    response_model=schemas.CopilotKeysStatus,
    summary="Get the state of the user's own Copilot keys",
    description="Returns which provider keys the signed-in user has saved. It never returns the keys.",
)
async def get_copilot_keys(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    return await app_helpers.get_copilot_key_status(db, user.uuid)


@router.put(
    "/copilot-keys",
    response_model=schemas.CopilotKeysStatus,
    summary="Save the user's own Copilot keys",
    description="Saves the provider keys in the request for the signed-in user and returns which keys are saved.",
)
async def put_copilot_keys(
    keys: schemas.CopilotProviderKeys,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    await app_helpers.set_copilot_provider_keys(db, user.uuid, keys)
    return await app_helpers.get_copilot_key_status(db, user.uuid)


MCP_REQUEST_HEADERS = frozenset(
    {"accept", "content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id"}
)
MCP_RESPONSE_HEADERS = (
    "content-type",
    "cache-control",
    "mcp-session-id",
    "www-authenticate",
    "mcp-protocol-version",
)
MCP_EXPOSED_HEADERS = "mcp-session-id, mcp-protocol-version, www-authenticate"


SSE_ENDPOINT_LIFETIME = timedelta(hours=24)
SSE_ANNOUNCEMENT_MAX_BYTES = 16 * 1024


def on_mcp_origin(server_url: str, url: str) -> bool:
    try:
        server = httpx.URL(schemas.normalize_mcp_url(server_url))
        target = httpx.URL(url)
    except httpx.InvalidURL:
        return False
    if (target.scheme, target.host, target.port) != (server.scheme, server.host, server.port):
        return False
    return not {".", ".."} & set(target.path.split("/"))


def under_mcp_server_path(server_url: str, url: str) -> bool:
    prefix = httpx.URL(schemas.normalize_mcp_url(server_url)).path.rstrip("/")
    path = httpx.URL(url).path
    return path == prefix or path.startswith(f"{prefix}/")


def _canonical_url(url: str | httpx.URL) -> str:
    return str(httpx.URL(url).copy_with(fragment=None))


def _sse_endpoint_key(user_uuid: UUID, server: str, endpoint: str) -> str:
    return auth_helpers.app_redis_key(
        f"mcp_sse_endpoint:{user_uuid}:{crypto.hash_token(server)}:"
        f"{crypto.hash_token(_canonical_url(endpoint))}"
    )


async def _record_sse_endpoint(
    user_uuid: UUID, server: str, stream_url: str, announced: str
) -> None:
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
    model_config = {"extra": "ignore"}

    server_url: str = Field(max_length=2048, description="The address of the MCP server.")
    url: str = Field(
        max_length=8192,
        description="The address that the request goes to. It must be on the server's origin, under the server's path.",
    )
    method: Literal["GET", "POST"] = Field("GET", description="The HTTP method of the request: `GET` or `POST`.")
    headers: dict[str, str] | None = Field(
        None,
        description="The headers to forward. The API forwards only the headers that the MCP protocol uses.",
    )
    body: dict | list | None = Field(None, description="The JSON body of a `POST` request.")

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


@router.post(
    "/mcp-proxy",
    response_class=StreamingResponse,
    summary="Forward a request to an MCP server",
    description=(
        "Forwards the request in the body to the MCP server that it names, with the headers or the OAuth sign-in that "
        "the user saved for that server, and streams the answer back. A call of a tool that the user's roles do not "
        "allow is refused. Answers 422 when the request does not go to the named server, 403 when the tool is not "
        "allowed or the server's address may not be reached, 504 when the server times out, and 502 when it cannot be "
        "reached. Only the web app can call it."
    ),
)
async def mcp_proxy(
    data: Annotated[MCPProxyRequest, Body()],
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(mcp_oauth.web_user),
):
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
