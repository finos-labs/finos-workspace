"""Workspace user routes"""

import re
from datetime import (
    date as dateType,
    datetime,
    timedelta,
)
from typing import Annotated, Literal
from urllib.parse import urlparse
from uuid import UUID

import httpx
import pyotp
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import (
    JSONResponse,
    Response,
    StreamingResponse,
)
from loguru import logger
from pydantic import field_validator
from sqlalchemy import delete, insert, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.background import BackgroundTask

from api import auth_helpers, base, crud, helpers, models, schemas
from api.database import aget_read_db, aget_write_db
from api.models import (
    User,
    UserInvite,
    UserRole,
)
from api.rate_limit import LIMIT_DEFAULT, exempt_service_token, exempt_user_agent, limiter
from api.schemas import SuccessReturn
from routers import app_helpers
from routers.routers_helpers import register_app_user
from utilities.config import BaseModel, settings

router = APIRouter(
    prefix="/app", tags=["app"], dependencies=[Depends(auth_helpers.check_origin)]
)


EXCEPTION_401 = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect username or password",
    headers={"WWW-Authenticate": "Bearer"},
)


async def process_create_user(
    the_uuid: UUID,
    email: str,
    db: AsyncSession = Depends(aget_write_db),
    microsoft_id: str | None = None,
) -> UUID | bool:
    "Creates the user for a pending invite; returns the new user's uuid, or False"
    if settings.DISABLE_REGISTRATION:
        raise HTTPException(status_code=403, detail="Registration is disabled")

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
        result.permissions_uuid = settings.DEVELOPER_MAPPING

    billing_active = await crud.total_user_count_full(db, result.permissions_uuid)
    if await crud.check_new_user(db, result.email):
        return False
    insert_query = insert(User).values(
        email=result.email,
        clean_email=base.clean_email(result.email),
        permissions_uuid=result.permissions_uuid,
        password=result.data["password"],
        first_name=result.data["first_name"],
        last_name=result.data["last_name"],
        billing_active=billing_active,
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
    await db.commit()

    return user_uuid


def bearer_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@router.post("/logout", response_model=SuccessReturn)
@limiter.limit("10/minute", exempt_when=exempt_user_agent)
async def logout(
    request: Request,
    db: AsyncSession = Depends(aget_write_db),
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True, from_logout=True)),
):
    if getattr(user, "uuid", None) is None:
        return SuccessReturn(success=True)
    await auth_helpers.delete_user_app_sessions(db, user.uuid, ["app", "oauth-app"])
    response = JSONResponse(content={"success": True}, status_code=200)
    response.delete_cookie(key="access_token")
    return response


@router.post("/login", response_model=schemas.AppTokenWithContext)
@limiter.limit("5/minute", exempt_when=exempt_service_token)
async def login(  # noqa: PLR0914, PLR0915
    request: Request,
    user: schemas.AppUserLogin,
    db: AsyncSession = Depends(aget_write_db),
):
    if not (
        result := (await db.execute(helpers.get_app_user_query(user.email))).first()
    ):
        raise EXCEPTION_401

    # A user without an entity is put into the default one
    if not result._asdict().get("permissions_uuid", None):
        await app_helpers.assign_default_mapping(db, result.uuid)
        # Re-fetch the user from the database
        result = (await db.execute(helpers.get_app_user_query(user.email))).first()

    db_user = schemas.AppUserSchema.model_validate(result)
    await app_helpers.check_login(
        db, user, db_user
    )  # Will raise if a problem is encountered

    # If the user does not have an entitlement, we assume it's an already existing user
    # that doesn't went through the developer onboarding process.
    has_entitlement = await app_helpers.has_entitlement(db, db_user.uuid)
    if not has_entitlement:
        await app_helpers.update_user_entitlement_with_entity_entitlement(
            db=db, user_uuid=db_user.uuid
        )

    if not db_user.confirmed:
        return JSONResponse(
            content={"message": "User is not confirmed"}, status_code=403
        )

    if (
        db_user.totp_secret
        and db_user.totp_active
        and int(pyotp.TOTP(db_user.totp_secret).now()) != user.totp_token
    ):
        return JSONResponse(content={"message": "Invalid TOTP token"}, status_code=202)

    if db_user.require_authenticator and not db_user.totp_active:
        # If the user's entity requires 2FA but not active,
        # we need to send them a new token and ask them to activate it
        access_token = await auth_helpers.create_login_token(
            db=db,
            user_uuid=db_user.uuid,
            expires_delta=timedelta(minutes=5),
            app_session=True,
            source=user.source or "",
        )
        return JSONResponse(
            content={
                "message": "Two-factor authentication is required",
                "access_token": access_token,
            },
            status_code=202,
        )

    show_changelog = (
        db_user.latest_version is not None and db_user.latest_version != user.version
    )
    if user.version and db_user.latest_version != user.version:
        update_query = (
            update(User)
            .where(User.uuid == db_user.uuid)
            .values(latest_version=user.version)
        )
        await db.execute(update_query)

    time_d = helpers.get_app_session_expiration(db_user, user.remember)

    sources = ["app", "oauth-app"] if user.source != "excel" else ["excel"]

    # Delete all other app sessions, except for excel
    await auth_helpers.delete_user_app_sessions(db, db_user.uuid, sources)

    access_token = await auth_helpers.create_login_token(
        db=db,
        user_uuid=db_user.uuid,
        expires_delta=time_d,
        app_session=True,
        source=user.source or "",
    )

    # Check if the user is logging in for the first time
    is_first_login = await helpers.check_first_login(
        db, db_user.uuid, ["oauth-app", "app"]
    )

    # Enter the login into our database
    helpers.handle_add_login(db_user.uuid, user.ip_address, user.source)

    # Get Copilot Chats
    chats = await app_helpers.get_copilot_chats(db, db_user.uuid)
    questions_history = await app_helpers.get_user_questions_history(db, db_user.uuid)

    # Get MCP servers
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
    curr_user = await auth_helpers.GetCurrentUser.call_logic(
        token=access_token, **auth_helpers.CURRENT_APP_USER
    )

    if settings.is_onprem():
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

    # Get Entitlements
    entitlements = await app_helpers.get_entitlement(db, db_user.uuid)

    # Get usage
    usage = await helpers.get_user_usage(db_user)

    # Get custom copilots
    custom_copilots = await app_helpers.get_custom_copilots(db, db_user.uuid)

    # Get user skills
    user_skills = await app_helpers.get_user_skill_state(db, db_user.uuid)

    content = {
        "uuid": db_user.uuid,
        "email": db_user.email,
        "access_token": access_token,
        "username": db_user.username,
        "expiration_date": base.get_now() + time_d,
        "temporary_password": bool(db_user.temporary_password)
        and user.source != "oauth-app",
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
        "feature_entitlements": entitlements,
        "usage": usage,
        "custom_copilots": custom_copilots,
        "mcp_servers": mcp_servers.servers if mcp_servers else None,
        "is_first_login": is_first_login,
    }

    context = schemas.AppTokenWithContext.model_validate(content)
    response = JSONResponse(content=jsonable_encoder(context))
    response.set_cookie(key="access_token", value=access_token, httponly=True)

    return response


async def process_auth(token: str, provider: auth_helpers.ProviderT, request: Request):
    """Processes OAuth authentication for a given provider."""
    url = auth_helpers.OAUTH_PROVIDERS.get(provider)
    if not url or not token:
        raise ValueError("Invalid provider or token")

    async with httpx.AsyncClient() as client:
        res = await client.get(url, headers=bearer_header(token))
        if res.is_error:
            raise HTTPException(
                status_code=400, detail=f"Invalid {provider.title()} token"
            )
        user_data: dict = res.json()
        return user_data


async def handle_oauth_user(
    request: Request, db: AsyncSession, user_data: dict, auth_data: schemas.AuthData
):
    """Handles OAuth user sign-in and sign-up process."""
    user_email = user_data.get("email")

    filters = [User.email == user_email]
    if microsoft_id := user_data.get("microsoft_id"):
        # Attempt to get id from OAuth data if available
        filters.append(User.microsoft_id == microsoft_id)

    user_exists = (
        (
            await db.execute(
                select(
                    User.uuid,
                    User.email,
                    User.microsoft_id,
                )
                .where(or_(*filters))
                .limit(1)
            )
        )
        .mappings()
        .first()
    )

    if not user_exists:
        # User does not exist, proceed with sign-up
        user_create = schemas.UserCreateAppAdmin(
            first_name=user_data.get("given_name"),
            last_name=user_data.get("family_name"),
            email=user_email,
            permissions_uuid=settings.DEVELOPER_MAPPING,
        )
        extra_info = schemas.RegisterAppUser()
        invite_uuid = await register_app_user(
            db, user_create, extra_info, from_oauth=True
        )
        if not invite_uuid or not await process_create_user(
            invite_uuid, user_email, db, microsoft_id=microsoft_id
        ):
            raise HTTPException(status_code=400, detail="Failed to create user")

    # User exists, proceed with sign-in
    user_login = schemas.OAuthLogin(
        email=user_exists["email"] if user_exists else user_email,
        remember=False,
        ip_address="",
        source="oauth-app",
        password="",
        version=auth_data.version,
    ).bypass_password_check()

    if (user_exists and user_exists["microsoft_id"] is None) and microsoft_id:
        # Update the user's Microsoft ID if it was not previously set
        await db.execute(
            update(User)
            .where(User.uuid == user_exists["uuid"])
            .values(microsoft_id=microsoft_id)
        )
        await db.commit()

    return await login(request, user_login, db)


@router.post("/{provider}-auth", response_model=schemas.AppTokenWithContext)
@limiter.limit("5/minute")
async def oauth_auth(
    request: Request,
    provider: auth_helpers.ProviderT,
    data: schemas.AuthData,
    db: AsyncSession = Depends(aget_write_db),
):
    """Endpoint for OAuth Authentication, both for sign-in and sign-up."""
    user_data = await process_auth(data.token, provider, request)
    user_email = user_data.get("email")

    if provider == "microsoft":
        user_email = user_data.get("mail") or user_data.get("userPrincipalName")
        user_data["email"] = user_email
        user_data["microsoft_id"] = user_data.get("id")
        user_data["given_name"] = user_data.get("givenName")
        user_data["family_name"] = user_data.get("surname")

    is_google = provider == "google"
    if not user_email or (is_google and not user_data.get("email_verified", False)):
        error_message = "found in token" if not is_google else "verified by Google"
        raise HTTPException(status_code=400, detail=f"Email not {error_message}")

    return await handle_oauth_user(request, db, user_data, data)


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
    user=Depends(auth_helpers.GetCurrentUser(**auth_helpers.CURRENT_APP_USER)),
):
    user_data = await app_helpers.set_app_user_data(user, db)
    user_data.widget_metadata = await app_helpers.get_widget_metadata(db=db, user=user)
    return user_data


@router.get("/validate", response_model=SuccessReturn)
async def validate_user(
    db: AsyncSession = Depends(aget_write_db),
    token=Depends(auth_helpers.get_current_token),
):
    query = (
        select(models.Session.expiration_date)
        .where(models.Session.uuid == token, models.Session.app_session.is_(True))
        .limit(1)
    )
    expiration_date = (await db.execute(query)).scalar_one_or_none()
    if expiration_date is None:
        return SuccessReturn.failure_instance()

    session = auth_helpers.CustomRow(expiration_date=expiration_date)
    try:
        await auth_helpers.check_session_expiration(session, token, db)
    except HTTPException:
        return SuccessReturn.failure_instance()

    return SuccessReturn.success_instance()


@router.get("/validate-and-sync", response_model=schemas.ValidateAndSync)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_user_agent)
async def validate_and_get_items(
    request: Request,
    db: AsyncSession = Depends(aget_write_db),
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)),
):
    """
    Validate the user token and retrieve the other relevant data.

    Args:
        db (AsyncSession): Database session dependency.
        user (User): Current user dependency.

    Returns:
        schemas.ValidateAndSync: ValidateAndSync object with the feature entitlements.


    Raises:
        HTTPException: If the token is invalid.
    """
    res = await validate_user(db=db, token=user.token)
    if not res.success:
        raise HTTPException(status_code=401, detail="invalid token")
    entitlements = await app_helpers.get_entitlement(db=db, user_uuid=user.uuid)
    return schemas.ValidateAndSync(
        feature_entitlements=entitlements,
    )


@router.post("/display-settings", response_model=SuccessReturn)
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


@router.post("/copilot-chats", response_model=schemas.EntitlementUsageGet)
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

    return await schemas.EntitlementUsageGet.check_cache(db, user)


@router.get("/copilot-chats", response_model=list[schemas.Chat | schemas.ChatInfo])
async def get_copilot_chats(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Endpoint to retrieve copilot chats for a user.

    This endpoint fetches the copilot chats associated with the current authenticated user.

    Args:
        db (AsyncSession): The database session.
        user: The current authenticated user.

    Returns:
        list[schemas.Chat | schemas.ChatInfo]: A list of copilot chats for the user.
    """
    result = await app_helpers.get_copilot_chats(db, user.uuid)
    if not result:
        raise HTTPException(
            status_code=404, detail="Copilot chats not found for the user"
        )
    return result


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


@router.post("/entitlement", response_model=SuccessReturn)
async def post_entitlement(
    entitlement: schemas.EntitlementPost,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Endpoint to create the entitlement for a user.

    Args:
        entitlement (schemas.EntitlementPost): The entitlement to be created or updated.

    Returns:
        SuccessReturn: An instance indicating the operation was successful.
    """

    has_entitlement = await app_helpers.has_entitlement(db, user.uuid)
    if not has_entitlement:
        await app_helpers.insert_entitlement(
            db=db, user_uuid=user.uuid, tier=entitlement.tier
        )
    else:
        raise HTTPException(status_code=400, detail="Entitlement already exists")
    return SuccessReturn.success_instance()


@router.put("/entitlement", response_model=SuccessReturn)
async def put_entitlement(
    entitlement: schemas.EntitlementPut,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    has_entitlement = await app_helpers.has_entitlement(db, user.uuid)
    if not has_entitlement:
        raise HTTPException(status_code=404, detail="Entitlement not found")

    await app_helpers.update_entitlement(
        db=db, user_uuid=user.uuid, tier=entitlement.tier
    )
    return SuccessReturn.success_instance()


@router.get("/entitlement", response_model=schemas.EntitlementGet)
async def get_entitlement(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Endpoint to retrieve the entitlement for a user.

    This endpoint retrieves the entitlement associated with the current authenticated user;
    If the user is associated with an entity, the returned entitlement will be the one associated with the entity.

    Args:

    Raises:
        HTTPException: If the entitlement is not found.

    Returns:
        schemas.EntitlementGet: The entitlement for the user.
    """
    result = await app_helpers.get_entitlement(db, user.uuid)
    if not result:
        raise HTTPException(status_code=404, detail="Entitlement not found")

    return result


@router.patch("/entitlement", response_model=SuccessReturn)
async def patch_entitlement(
    entitlement: schemas.EntitlementPatch,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin=Depends(auth_helpers.get_current_admin),
):
    """
    Endpoint to update the entitlement of the current authenticated admin.

    Limits and privileges are set by admins, so users cannot change their own.
    One or all of the fields can be updated.

    Args:
        entitlement (schemas.EntitlementPatch): The entitlement to be updated.

    Returns:
        SuccessReturn: An instance indicating the operation was successful.
    """
    tiers_match = {
        "full": models.FULL_TIER_ID,
        "basic": models.BASIC_TIER_ID,
    }
    if not await app_helpers.has_entitlement(db, admin.uuid):
        raise HTTPException(status_code=404, detail="Entitlement not found")

    entitlement_dict = entitlement.model_dump(exclude_unset=True)
    if tier := entitlement_dict.pop("tier", None):
        entitlement_dict["tier_id"] = tiers_match.get(tier)

    if bundle_name := entitlement_dict.pop("bundle_name", None):
        entitlement_dict["data_bundle_uuid"] = await app_helpers.get_data_bundle_uuid(
            db, bundle_name
        )

    query = (
        update(models.Entitlement)
        .where(models.Entitlement.user_uuid == admin.uuid)
        .values(**entitlement_dict)
    )
    await db.execute(query)
    await db.commit()
    app_helpers.invalidate_usage_cache(admin.uuid)
    return SuccessReturn.success_instance()


@router.put(
    "/usage",
    response_model=schemas.EntitlementUsageGet,
    dependencies=[Depends(auth_helpers.check_metering)],
)
async def put_usage(
    usage: schemas.EntitlementUsagePut,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """Record the Copilot usage of a user.

    Only the service that serves the Copilot may call this (see
    `auth_helpers.check_metering`): the usage that limits are checked against must not be
    writable by the people the limits apply to. Users cannot add, subtract or reset it.

    A query is refused once it would exceed the daily query limit, or once the daily
    token limit is used up. Tokens are reported after a query ran, so they are always
    recorded.
    """
    limits = await schemas.EntitlementUsageGet.check_cache(db, user)
    row = (
        await db.execute(
            select(
                models.EntitlementUsage.number_copilot_calls_day_count,
                models.EntitlementUsage.number_copilot_tokens_day_count,
            ).where(models.EntitlementUsage.user_uuid == user.uuid)
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
        query = insert(models.EntitlementUsage).values(
            user_uuid=user.uuid,
            number_copilot_calls_day_count=new_calls,
            number_copilot_tokens_day_count=usage.add_copilot_tokens,
        )
    elif usage.reset_copilot_count:
        query = (
            update(models.EntitlementUsage)
            .where(models.EntitlementUsage.user_uuid == user.uuid)
            .values(
                number_copilot_calls_day_count=new_calls,
                number_copilot_tokens_day_count=usage.add_copilot_tokens,
            )
        )
    else:
        # Tokens are added in the database so that concurrent queries do not overwrite
        # each other
        query = (
            update(models.EntitlementUsage)
            .where(models.EntitlementUsage.user_uuid == user.uuid)
            .values(
                number_copilot_calls_day_count=new_calls,
                number_copilot_tokens_day_count=models.EntitlementUsage.number_copilot_tokens_day_count
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
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """Check a Copilot request against what the user may use.

    The service that serves the Copilot calls this before it runs a query, with the
    user's session token and the metering token (see `auth_helpers.check_metering`). The
    browser only hides what a user may not use, this is what enforces it.
    """
    access = await app_helpers.get_user_copilot_access(db, user.uuid)
    return app_helpers.check_copilot_access(access, request)


@router.get("/usage", response_model=schemas.EntitlementUsageGet)
async def get_usage(
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    result = await schemas.EntitlementUsageGet.check_cache(db, user)
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
async def patch_widget_metadata(  # noqa: PLR0913, PLR0917
    widget_metadata: schemas.WidgetMetadataResponsePatch,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    widget_id: UUID | None = None,
    widget_type: schemas.MetaDataWidgetType | None = None,
    name: str | None = None,
):
    """
    Update an existing widget metadata entry.

    Args:
        widget_metadata (schemas.WidgetMetadataResponse): The widget metadata to be updated.
        db (AsyncSession): The database session.
        user (User): The authenticated user.

    Returns:
        schemas.SuccessReturn: A success response indicating the operation was successful.
    """
    if not widget_id and not (widget_type and name):
        raise HTTPException(
            status_code=422, detail="Either id or widget_type and name must be provided"
        )

    query = update(models.WidgetMetadata).where(
        models.WidgetMetadata.user_uuid == user.uuid
    )
    if widget_id:
        query = query.where(models.WidgetMetadata.widget_id == widget_id)

    else:
        query = query.where(
            models.WidgetMetadata.widget_type == widget_type,
            models.WidgetMetadata.name == name,
        )

    query = query.values(**widget_metadata.model_dump(exclude_unset=True))

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


@router.get("/user-has-entity", response_model=schemas.SuccessReturn)
async def user_has_entity(
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    """
    Check if the user has an entity which is not Workspace default Developer Entity.
    """
    permissions_uuid_query = select(models.User.permissions_uuid).where(
        models.User.uuid == user.uuid
    )
    permissions_uuid = (await db.execute(permissions_uuid_query)).scalar_one_or_none()
    if permissions_uuid and (
        permissions_uuid != settings.DEVELOPER_MAPPING or settings.is_onprem()
    ):
        return schemas.SuccessReturn.success_instance()
    return schemas.SuccessReturn.failure_instance()


@router.put("/custom-copilot", response_model=SuccessReturn)
async def put_custom_copilot(
    custom_copilot: schemas.CustomCopilot,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Update or insert a custom copilot for a user.
    """
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


@router.get("/skills", response_model=list[schemas.SkillReturn])
async def get_user_skill(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """
    Get the user skills state.
    """
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
    """
    Add or update the MCP servers for a user.
    """
    query = (
        select(models.MCPServers.uuid)
        .where(models.MCPServers.user_uuid == user.uuid)
        .limit(1)
    )
    result = (await db.execute(query)).scalar_one_or_none()
    if result is not None:
        # If the user already has MCP servers, update them
        query = (
            update(models.MCPServers)
            .where(models.MCPServers.user_uuid == user.uuid)
            .values(**mcp_servers.model_dump())
        )
    else:
        # If the user doesn't have MCP servers, insert them
        query = insert(models.MCPServers).values(
            user_uuid=user.uuid, **mcp_servers.model_dump()
        )
    await db.execute(query)
    await db.commit()

    return await app_helpers.get_mcp_servers(db, user)


class MCPProxyRequest(BaseModel):
    model_config = {"extra": "ignore"}

    url: str
    method: Literal["GET", "POST"] = "GET"
    headers: dict | None = None
    body: dict | list | None = None

    @field_validator("url")
    def validate_url(cls, v: str) -> str:
        """Filter unsupported MCP urls.

        TODO: Consider adding the following patterns.
            - If ALLOWED_MCP_HOSTNAMES is explicitly set it becomes and explicit allow-list
            - In-cluster DNS endpoints are in deny-list (*.svc.cluster.local pattern)
            - Transport-level filtering: http in deny-list
        """
        # Prevent SSRF attacks
        parsed_url = urlparse(v)
        hostname = parsed_url.hostname

        if hostname in settings.ALLOWED_MCP_HOSTNAMES:
            return v

        # Block localhost and IP based urls
        if hostname in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Invalid URL: localhost is not allowed")

        if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", hostname):
            raise ValueError("Invalid URL: IP addresses are not allowed")

        return v


mcp_proxy_client = httpx.AsyncClient(
    timeout=httpx.Timeout(10.0, read=300.0, connect=5.0)
)


def handle_cors(request: Response) -> dict[str, str]:
    origin = request.headers.get("Origin") or "*"
    cors_headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, www-authenticate",
        "Access-Control-Expose-Headers": "mcp-session-id, www-authenticate",
        "Access-Control-Max-Age": "86400",
    }

    return cors_headers


async def check_mcp_tool_calls(
    db: AsyncSession, user_uuid: UUID, data: MCPProxyRequest
) -> None:
    """Refuse the tool calls in a proxied request that the user's roles do not grant."""
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
        if not app_helpers.is_mcp_tool_allowed(access, data.url, name):
            raise HTTPException(
                status_code=403, detail=f"You do not have access to the tool `{name}`"
            )


@router.post("/mcp-proxy", response_class=StreamingResponse)
async def mcp_proxy(
    data: Annotated[MCPProxyRequest, Body()],
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    """Proxy a request to the MCP service.
    This is used to allow the frontend to make requests to the MCP service to avoid CORS issues.
    Tool calls are limited to the tools the user's roles grant.
    """
    await check_mcp_tool_calls(db, user.uuid, data)
    kwargs = {"headers": data.headers, "json": data.body}
    try:
        content_type = data.headers.get("content-type", "") if data.headers else ""
        # httpx requires form data to be sent as `data` instead of `json`
        if "x-www-form-urlencoded" in content_type and isinstance(data.body, dict):
            kwargs["data"] = kwargs.pop("json")

        req = mcp_proxy_client.build_request(data.method, data.url, **kwargs)
        r = await mcp_proxy_client.send(req, stream=True, follow_redirects=True)
        r.headers.update(handle_cors(r))

        return StreamingResponse(
            content=r.aiter_raw(),
            status_code=r.status_code,
            headers=r.headers,
            background=BackgroundTask(r.aclose),
        )

    except httpx.ReadTimeout as e:
        raise HTTPException(
            status_code=504, detail="MCP service request timed out"
        ) from e
    except httpx.RequestError as e:
        logger.error(f"An error occurred while requesting {e.request.url!r}.")
        raise HTTPException(
            status_code=502, detail="Error connecting to MCP service"
        ) from e
