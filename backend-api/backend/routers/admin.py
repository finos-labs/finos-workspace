"""Entity routes"""

import io
from contextlib import suppress
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy import Row, delete, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api import auth_helpers, crud, helpers, models, schemas
from api.base import clean_email, get_now, random_password
from api.database import aget_read_db, aget_write_db
from api.models import (
    Entity,
    PermissionsEntityMap,
    User,
    UserInvite,
    UserRole,
)
from api.rate_limit import LIMIT_DEFAULT, exempt_service_token, limiter
from api.schemas import ResetPasswordReturn, SuccessReturn
from routers import app_helpers, routers_helpers
from scripts import export_user_data
from utilities.config import BaseModel

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminPutEntity(BaseModel):
    require_authenticator: None | bool = None


async def get_admin_entity(db: AsyncSession, permissions_uuid: UUID) -> UUID:
    admin_query = select(PermissionsEntityMap.entity_uuid).where(
        PermissionsEntityMap.uuid == permissions_uuid
    )
    admin_entity_uuid = (await db.execute(admin_query)).scalar_one_or_none()
    if admin_entity_uuid is None:
        raise HTTPException(404, detail="Could not find the provided permissions map")
    return admin_entity_uuid


@router.patch("/entity", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def patch_entity(
    request: Request,
    data: AdminPutEntity,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    admin_result = await get_admin_entity(db, admin.permissions_uuid)
    clean_values = data.model_dump(exclude_none=True)
    query = update(Entity).where(Entity.uuid == admin_result).values(**clean_values)
    response2 = await db.execute(query)
    if response2.rowcount == 0:
        raise HTTPException(404, detail="Entity does not exist")
    await db.commit()

    if data.require_authenticator is not None:
        await app_helpers.require_entity_users_2fa(
            db, admin_result, data.require_authenticator
        )

    return SuccessReturn.success_instance()


@router.get("/entity", response_model=AdminPutEntity)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_entity(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    admin_result = await get_admin_entity(db, admin.permissions_uuid)
    query = select(Entity.require_authenticator).where(Entity.uuid == admin_result)
    return (await db.execute(query)).first()


@router.get("/entity-map", response_model=list[schemas.EntityMapReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_entity_maps(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    admin_result = await get_admin_entity(db, admin.permissions_uuid)
    query = (
        select(PermissionsEntityMap)
        .options(selectinload(PermissionsEntityMap.entity))
        .where(PermissionsEntityMap.entity_uuid == admin_result)
    )

    return (await db.execute(query)).scalars().all()


@router.post("/register", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def register_user(
    request: Request,
    user: schemas.UserCreateAdmin,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """Allows an admin to register a new user"""
    await crud.check_clean_email(db, user.email)
    admin_query = (
        select(Entity.uuid)
        .select_from(PermissionsEntityMap)
        .join(Entity, Entity.uuid == PermissionsEntityMap.entity_uuid)
        .where(PermissionsEntityMap.uuid == admin.permissions_uuid)
    )
    admin_result = (await db.execute(admin_query)).first()
    if not admin_result:
        raise HTTPException(
            404, detail="Could not find the entity associated with the given admin"
        )
    perms_query = select(PermissionsEntityMap.entity_uuid).where(
        PermissionsEntityMap.uuid == user.permissions_uuid
    )
    perms_result = (await db.execute(perms_query)).first()
    if perms_result is None:
        raise HTTPException(404, detail="Could not find the provided permissions map")
    if perms_result.entity_uuid != admin_result.uuid:
        raise HTTPException(403, detail="Invalid permissions")
    extra_info = schemas.RegisterAppUser(inviting_uuid=admin.uuid)
    result = await routers_helpers.register_app_user(db, user, extra_info)
    return SuccessReturn.from_bool(result)


@router.delete("/register/{invite_uuid}", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def revoke_register_user(
    invite_uuid: UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    admin_query = (
        select(Entity.uuid)
        .select_from(PermissionsEntityMap)
        .join(Entity, Entity.uuid == PermissionsEntityMap.entity_uuid)
        .where(PermissionsEntityMap.uuid == admin.permissions_uuid)
    )
    admin_result = (await db.execute(admin_query)).first()
    if not admin_result:
        raise HTTPException(
            404, detail="Could not find the entity associated with the given admin"
        )
    perms_query = (
        select(PermissionsEntityMap.entity_uuid)
        .join(
            UserInvite, UserInvite.permissions_uuid == PermissionsEntityMap.uuid
        )
        .where(UserInvite.uuid == invite_uuid)
    )
    perms_result = (await db.execute(perms_query)).first()
    if perms_result is None:
        raise HTTPException(404, detail="Could not find the provided permissions map")
    if perms_result.entity_uuid != admin_result.uuid:
        raise HTTPException(403, detail="Invalid permissions")
    delete_query = delete(UserInvite).where(UserInvite.uuid == invite_uuid)
    await db.execute(delete_query)
    await db.commit()
    return SuccessReturn.success_instance()


@router.delete("/users/{user_uuid}/remove", response_model=SuccessReturn)
async def remove_user(
    request: Request,
    user_uuid: UUID,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """This endpoint is used to remove a user from an entity."""
    await ensure_user_in_admin_entity(db, admin, user_uuid)
    await ensure_not_superuser_target(db, admin, user_uuid)
    if admin.is_superuser:
        query = update(User).where(User.uuid == user_uuid).values(permissions_uuid=None)
        response = await db.execute(query)
    else:
        admin_result = await get_admin_entity(db, admin.permissions_uuid)
        maps_query = select(PermissionsEntityMap.uuid).where(
            PermissionsEntityMap.entity_uuid == admin_result
        )
        maps_result = (await db.execute(maps_query)).all()
        maps_clean = [item.uuid for item in maps_result]
        query = (
            update(User)
            .where(User.uuid == user_uuid, User.permissions_uuid.in_(maps_clean))
            .values(permissions_uuid=None)
        )
        response = await db.execute(query)
    # Nothing of a user outside the organization is touched
    if response.rowcount == 0:
        raise HTTPException(404, detail="Matching user not found")

    await crud.remove_shares_both_ways(db, user_uuid)
    await crud.update_user_dashboards_new_entity(db, user_uuid)

    await db.commit()
    await app_helpers.left_organization(db, user_uuid)
    return SuccessReturn.success_instance()


@router.delete("/users/{user_uuid}", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def delete_user(
    request: Request,
    user_uuid: UUID,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """This endpoint is used to soft delete a user."""
    await ensure_user_in_admin_entity(db, admin, user_uuid)
    await ensure_not_superuser_target(db, admin, user_uuid)
    result = await app_helpers.delete_user(db, user_uuid)
    return SuccessReturn.from_bool(result)


@router.patch("/users/{user_uuid}", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def update_user(
    request: Request,
    user_uuid: UUID,
    update_info: schemas.UserAdminUpdate,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    await ensure_user_in_admin_entity(db, admin, user_uuid)
    await ensure_not_superuser_target(db, admin, user_uuid)
    admin_query = (
        select(Entity.uuid)
        .select_from(PermissionsEntityMap)
        .join(Entity, Entity.uuid == PermissionsEntityMap.entity_uuid)
        .where(PermissionsEntityMap.uuid == admin.permissions_uuid)
    )
    admin_result = (await db.execute(admin_query)).first()
    if not admin_result:
        raise HTTPException(
            404, detail="Could not find the entity associated with the given admin"
        )
    maps_query = select(PermissionsEntityMap.uuid).where(
        PermissionsEntityMap.entity_uuid == admin_result.uuid
    )
    maps_result = (await db.execute(maps_query)).all()
    maps_clean = [item.uuid for item in maps_result]

    # Moving a user to another organization is a superuser's (PUT /entity/user)
    if (
        update_info.permissions_uuid is not None
        and update_info.permissions_uuid not in maps_clean
    ):
        raise HTTPException(
            403, detail="Cannot assign permissions from a different organization"
        )

    data = {}
    for field in update_info.model_fields_set:
        value = getattr(update_info, field)
        if value is not None:
            data[field] = value
    query = (
        update(User)
        .where(User.uuid == user_uuid, User.permissions_uuid.in_(maps_clean))
        .values(**data)
    )
    response = await db.execute(query)
    await db.commit()
    # In theory we should remove shares here, but since an admin should only be able to change inside the entity
    # it feels unnecessary
    if response.rowcount == 0:
        raise HTTPException(404, detail="Matching user not found")
    # A user's type sets their limits (a developer has none)
    if "permissions_uuid" in data:
        app_helpers.invalidate_usage_cache(user_uuid)

    return SuccessReturn.success_instance()


@router.get("/validate", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def validate_admin(
    request: Request,
    _: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """This endpoint is used to validate that the user is an admin."""
    return SuccessReturn.success_instance()


@router.get("/users", response_model=list[schemas.UserAdminReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def see_users(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    results: list[schemas.UserAdminReturn] = []

    def add_to_list(to_add: list[dict], source: schemas.UserSourceType):
        for result in to_add:
            item = schemas.UserAdminReturn(source=source, **result)
            results.append(item)

    admin_result = await get_admin_entity(db, admin.permissions_uuid)
    results1 = await helpers.get_managed_users(db, admin_result)
    add_to_list([x._mapping for x in results1], source="user")
    results3 = await helpers.get_invite_users(db, admin_result)
    cleaned3 = [
        {
            "email": x[0],
            "role": x[1],
            "first_name": x[2].get("first_name"),
            "last_name": x[2].get("last_name"),
            "uuid": x[3],
        }
        for x in results3
    ]
    add_to_list(cleaned3, source="invite")
    return results


@router.get("/apps", response_model=list[schemas.AppReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_apps(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """Retrieve all apps for users in the entity, sorted by user_uuid"""
    admin_result = await get_admin_entity(db, admin.permissions_uuid)

    # Get all users in the entity
    maps_query = select(PermissionsEntityMap.uuid).where(
        PermissionsEntityMap.entity_uuid == admin_result
    )
    maps_result = (await db.execute(maps_query)).all()
    maps_clean = [item.uuid for item in maps_result]

    # Get all users with these permission maps
    users_query = select(User.uuid, User.email).where(
        User.permissions_uuid.in_(maps_clean),
        User.deleted.is_(False),
    )
    users_result = (await db.execute(users_query)).all()
    user_dict = {user.uuid: user.email for user in users_result}

    # Get all apps for these users
    apps_query = (
        select(
            models.ApiSource.uuid,
            models.ApiSource.name,
            models.ApiSource.url,
            models.ApiSource.user_uuid,
            models.ApiSource.created_date,
            models.ApiSource.updated_date,
        )
        .where(models.ApiSource.user_uuid.in_(user_dict.keys()))
        .order_by(models.ApiSource.user_uuid)
    )

    apps_result = (await db.execute(apps_query)).all()

    if apps_result is None:
        raise HTTPException(404, detail="No apps found")

    return [
        schemas.AppReturn(
            uuid=app.uuid,
            name=app.name,
            url=str(app.url),
            user_email=user_dict.get(app.user_uuid),
            user_uuid=app.user_uuid,
            created_date=app.created_date,
            updated_date=app.updated_date,
        )
        for app in apps_result
    ]


async def ensure_user_in_admin_entity(
    db: AsyncSession, admin: User, user_uuid: UUID
) -> None:
    """Admins manage the users of their own organization. Superusers manage anyone."""
    if admin.is_superuser:
        return

    admin_entity_uuid = await get_admin_entity(db, admin.permissions_uuid)
    target_entity_query = (
        select(PermissionsEntityMap.entity_uuid)
        .join(User, User.permissions_uuid == PermissionsEntityMap.uuid)
        .where(User.uuid == user_uuid)
    )
    target_entity_uuid = (await db.execute(target_entity_query)).scalar_one_or_none()
    if target_entity_uuid is None:
        raise HTTPException(404, detail="Matching user not found")
    if target_entity_uuid != admin_entity_uuid:
        raise HTTPException(403, detail="Cannot manage users outside your organization")


async def ensure_not_superuser_target(
    db: AsyncSession, admin: User, user_uuid: UUID
) -> None:
    """Only superusers manage the accounts of superusers, who act in every organization."""
    if admin.is_superuser:
        return

    target_is_superuser = (
        await db.execute(select(User.is_superuser).where(User.uuid == user_uuid))
    ).scalar_one_or_none()
    if target_is_superuser:
        raise HTTPException(403, detail="Only superusers can manage superusers")


@router.post("/usage/{user_uuid}/reset", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def post_reset_usage(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user_uuid: UUID,
    admin: Annotated[User, Depends(auth_helpers.get_current_admin)],
):
    """Endpoint to reset the Copilot usage (queries and tokens) of a user for the day."""
    await ensure_user_in_admin_entity(db, admin, user_uuid)
    await ensure_not_superuser_target(db, admin, user_uuid)

    await db.execute(
        update(models.UserUsage)
        .where(models.UserUsage.user_uuid == user_uuid)
        .values(number_copilot_calls_day_count=0, number_copilot_tokens_day_count=0)
    )
    await db.commit()
    app_helpers.invalidate_usage_cache(user_uuid)
    return SuccessReturn.success_instance()


@router.post("/reset-password/{user_uuid}", response_model=ResetPasswordReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def post_reset_password(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user_uuid: UUID,
    admin: Annotated[User, Depends(auth_helpers.get_current_admin)],
):
    """Endpoint to reset the password for a user."""
    if not admin.is_superuser:
        admin_entity_uuid = await get_admin_entity(db, admin.permissions_uuid)
        target_entity_query = (
            select(PermissionsEntityMap.entity_uuid)
            .join(User, User.permissions_uuid == PermissionsEntityMap.uuid)
            .where(User.uuid == user_uuid)
        )
        target_entity_uuid = (
            await db.execute(target_entity_query)
        ).scalar_one_or_none()
        if target_entity_uuid is None or target_entity_uuid != admin_entity_uuid:
            raise HTTPException(
                403, detail="Cannot reset password for users outside your organization"
            )
    await ensure_not_superuser_target(db, admin, user_uuid)

    new_password = random_password()
    update_query = (
        update(User)
        .where(User.uuid == user_uuid)
        .values(password=new_password, temporary_password=True)
    )
    await db.execute(update_query)
    await db.commit()

    # Remove all sessions for the user
    delete_query = delete(models.Session).where(models.Session.user_uuid == user_uuid)
    await db.execute(delete_query)
    await db.commit()

    return ResetPasswordReturn(
        success=True,
        temporary_password=new_password,
    )


@router.post("/users/{user_uuid}/export")
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def post_export_user_data(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user_uuid: UUID,
    superuser: Annotated[User, Depends(auth_helpers.get_current_superuser)],
    include_history: Annotated[
        bool, Query(description="Include dashboard version history")
    ] = False,
    with_files: Annotated[
        bool,
        Query(
            description="Download the account's uploaded files into the archive. "
            "Slow -- on a large account this can exceed the proxy's idle timeout."
        ),
    ] = False,
):
    """Export a user's account as a portable zip archive.

    **Superuser only.** Org admins cannot call this. The archive is a complete
    copy of somebody's account including their credentials, so the bar is
    deliberately higher than for the rest of /admin -- an org admin resetting a
    password is recoverable, exfiltrating an account is not.

    The archive carries the user's dashboards, widgets, custom backends and
    chats, and can be imported into Lite. Uploaded files travel in the
    archive's files/ folder for the user to keep, but are not reinstated on
    import. Exactly what travels is defined by ``scripts.user_data_scope``.

    The archive's credentials are sealed under an export key made for it alone,
    returned once in the ``X-Workspace-Export-Key`` header and stored nowhere; the
    import needs it.
    """
    target_query = select(User).where(User.uuid == user_uuid)
    target = (await db.execute(target_query)).scalar_one_or_none()
    if target is None:
        raise HTTPException(404, detail="User not found")

    logger.info(
        f"Superuser {superuser.email} is exporting the account {target.email}"
    )

    try:
        payload, result = await export_user_data.build_archive(
            db,
            str(target.email),
            include_history=include_history,
            with_files=with_files,
        )
    except export_user_data.ExportError as exc:
        raise HTTPException(400, detail=str(exc)) from exc

    return StreamingResponse(
        io.BytesIO(payload),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{result.archive.name}"',
            "X-Workspace-Export-Rows": str(result.total_rows),
            "X-Workspace-Export-Files": str(result.files_written),
            "X-Workspace-Export-Key": result.export_key,
            "Cache-Control": "no-store",
        },
    )


@router.post("/reset-2fa/{user_uuid}", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def post_reset_2fa(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user_uuid: UUID,
    admin: Annotated[User, Depends(auth_helpers.get_current_admin)],
):
    """Endpoint to reset the 2FA for a user."""
    if not admin.is_superuser:
        admin_entity_uuid = await get_admin_entity(db, admin.permissions_uuid)
        target_entity_query = (
            select(PermissionsEntityMap.entity_uuid)
            .join(User, User.permissions_uuid == PermissionsEntityMap.uuid)
            .where(User.uuid == user_uuid)
        )
        target_entity_uuid = (
            await db.execute(target_entity_query)
        ).scalar_one_or_none()
        if target_entity_uuid is None or target_entity_uuid != admin_entity_uuid:
            raise HTTPException(
                403, detail="Cannot reset 2FA for users outside your organization"
            )
    await ensure_not_superuser_target(db, admin, user_uuid)
    update_query = (
        update(User)
        .where(User.uuid == user_uuid)
        .values(totp_secret=None, totp_active=False)
    )
    await db.execute(update_query)
    await db.commit()

    # Remove all sessions for the user
    delete_query = delete(models.Session).where(models.Session.user_uuid == user_uuid)
    await db.execute(delete_query)
    await db.commit()

    return SuccessReturn.success_instance()


@router.post("/create-user", response_model=schemas.ResetPasswordReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def create_user(
    request: Request,
    user: schemas.UserCreateAdmin,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """Allows an admin to register a new user, if the user isn't already registered or invited"""
    # The user joins the admin's organization, with a role of it
    entity_uuid = await get_admin_entity(db, user.permissions_uuid)
    if not admin.is_superuser and entity_uuid != await get_admin_entity(
        db, admin.permissions_uuid
    ):
        raise HTTPException(403, detail="Cannot add users to another organization")
    if user.role and not await app_helpers.role_exists(db, user.role, entity_uuid):
        raise HTTPException(404, detail="Role not found")

    # Check if the user is already invited
    query_invite = select(UserInvite.uuid).where(UserInvite.email == user.email)
    invite_result = (await db.execute(query_invite)).first()
    if invite_result:
        raise HTTPException(409, detail="User is already invited")

    # Check if the user is already registered
    if await crud.check_new_user(db, user.email):
        raise HTTPException(409, detail="A user with this email already exists")

    # Create user
    random_pw = random_password()
    insert_query = insert(User).values(
        email=user.email,
        clean_email=clean_email(user.email),
        permissions_uuid=user.permissions_uuid,
        password=random_pw,
        first_name=user.first_name,
        last_name=user.last_name,
        app_start=get_now(),
        confirmed=1,
        temporary_password=True,
    )
    response = await db.execute(insert_query)

    if response.rowcount == 0:
        raise HTTPException(404, detail="User was not created")
    user_uuid = response.inserted_primary_key[0]

    # Add role if provided
    if role := user.role:
        role_insert = insert(UserRole).values(
            user_uuid=user_uuid,
            role_uuid=role,
        )
        await db.execute(role_insert)

    await db.commit()
    if user.role:
        await app_helpers.roles_changed(db, [user_uuid])
    return schemas.ResetPasswordReturn(
        success=True,
        temporary_password=random_pw,
    )


@router.post("/role", response_model=schemas.SuccessReturn)
async def post_role(
    role: schemas.PostRole,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """
    Create a new role for the entity
    """
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    new_role = models.Role(**role.model_dump(exclude={"users"}), entity_uuid=entity_uuid)
    db.add(new_role)
    await db.flush()
    role_uuid = new_role.uuid

    if role.users:
        await app_helpers.add_users_to_role(db, role_uuid, role.users)

    await db.commit()
    await app_helpers.roles_changed(
        db, await app_helpers.get_role_user_uuids(db, role_uuid)
    )

    return schemas.SuccessReturn.success_instance()


@router.get("/role", response_model=list[schemas.GetRoleWithUsers])
async def get_roles(
    db: AsyncSession = Depends(aget_read_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """
    Get all roles for the entity
    """
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    query = select(models.Role).where(
        models.Role.entity_uuid == entity_uuid, models.Role.deleted_at.is_(None)
    )
    roles = await db.execute(query)

    result = []
    for role in roles.scalars():
        role_users = await app_helpers.get_role_users(db, role.uuid)
        result.append(schemas.GetRoleWithUsers.from_role(role, role_users))
    return result


@router.get("/role/{role_uuid}", response_model=schemas.GetRoleWithUsers)
async def get_role(
    role_uuid: UUID,
    db: AsyncSession = Depends(aget_read_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """Get a role by uuid"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    role = (
        await db.execute(
            select(models.Role).where(
                models.Role.uuid == role_uuid,
                models.Role.entity_uuid == entity_uuid,
                models.Role.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    role_users = await app_helpers.get_role_users(db, role_uuid)
    return schemas.GetRoleWithUsers.from_role(role, role_users)


@router.patch("/role/{role_uuid}", response_model=schemas.SuccessReturn)
async def patch_role(
    role_uuid: UUID,
    role: schemas.PatchRole,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """Patch a role"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")
    affected_users = set(await app_helpers.get_role_user_uuids(db, role_uuid))

    # Update the role details and settings that were sent
    adjusted_role = role.changes()

    if adjusted_role:
        db_role = await db.get(models.Role, role_uuid)
        if db_role and db_role.entity_uuid == entity_uuid:
            for key, value in adjusted_role.items():
                setattr(db_role, key, value)
            await db.flush()

    # Update users if provided
    if role.users is not None:  # Check if None since empty list is valid
        await app_helpers.update_role_users(db, role_uuid, role.users)

    await db.commit()
    affected_users.update(await app_helpers.get_role_user_uuids(db, role_uuid))
    await app_helpers.roles_changed(db, list(affected_users))
    return schemas.SuccessReturn.success_instance()


@router.delete("/role/{role_uuid}", response_model=schemas.SuccessReturn)
async def delete_role(
    role_uuid: UUID,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """Delete a role"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")

    role = await db.get(models.Role, role_uuid)
    if not role or role.entity_uuid != entity_uuid:
        raise HTTPException(status_code=404, detail="Role not found")

    await role.soft_delete(db)
    await db.commit()
    await app_helpers.roles_changed(
        db, await app_helpers.get_role_user_uuids(db, role_uuid)
    )

    return schemas.SuccessReturn.success_instance()


async def check_role_items_in_entity(
    db: AsyncSession,
    entity_uuid: UUID,
    role_uuid: UUID,
    role_permissions: list[schemas.RolePermissions],
) -> None:
    """A role grants only what belongs to its organization: the organization's backends
    and the backends, files and prompts its users brought. What the role already grants
    can always be taken away."""
    members = (
        select(User.uuid)
        .join(PermissionsEntityMap, PermissionsEntityMap.uuid == User.permissions_uuid)
        .where(PermissionsEntityMap.entity_uuid == entity_uuid)
    )
    owned = {
        "backend": (
            models.ApiSource,
            or_(
                models.ApiSource.entity_uuid == entity_uuid,
                models.ApiSource.user_uuid.in_(members),
            ),
        ),
        "file": (models.FileWidget, models.FileWidget.user_uuid.in_(members)),
        "prompt": (models.UserPrompts, models.UserPrompts.user_uuid.in_(members)),
    }
    granted = {
        "backend": select(models.RoleBackend.backend_uuid).where(
            models.RoleBackend.role_uuid == role_uuid
        ),
        "file": select(models.RoleFile.file_uuid).where(
            models.RoleFile.role_uuid == role_uuid
        ),
        "prompt": select(models.RolePrompt.prompt_uuid).where(
            models.RolePrompt.role_uuid == role_uuid
        ),
    }

    def grants(item: schemas.RolePermissions) -> bool:
        accesses = [item.access, *(widget.access for widget in item.widgets or [])]
        for template in item.templates or []:
            accesses += [template.access, *(p.access for p in template.prompts or [])]
        return any(access != "no-access" for access in accesses)

    def kind(item: schemas.RolePermissions) -> str:
        # The templates of a backend are granted as a prompt item naming the backend
        if item.type == "prompt" and not item.prompt and item.templates:
            return "backend"
        return item.type

    for item_type, (model, in_entity) in owned.items():
        items = [item for item in role_permissions if kind(item) == item_type]
        if not items:
            continue
        revocable = set((await db.execute(granted[item_type])).scalars())
        uuids = {
            item.uuid for item in items if grants(item) or item.uuid not in revocable
        }
        if not uuids:
            continue
        found = (
            await db.execute(select(model.uuid).where(model.uuid.in_(uuids), in_entity))
        ).scalars()
        if uuids - set(found):
            raise HTTPException(
                403, detail="Cannot grant items from outside your organization"
            )


@router.put("/role-permissions/{role_uuid}", response_model=schemas.SuccessReturn)
async def put_role_permissions(
    role_uuid: UUID,
    role_permissions: list[schemas.RolePermissions],
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """Update the permissions for a role"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")
    await check_role_items_in_entity(db, entity_uuid, role_uuid, role_permissions)

    for item in role_permissions:
        if item.type == "backend":
            await app_helpers.insert_or_update_backend_permissions(
                db, role_uuid, item.uuid, item
            )
        elif item.type == "file":
            await app_helpers.insert_or_update_file_permissions(
                db, role_uuid, item.uuid, item.access
            )
        elif item.type == "prompt":
            if not item.prompt and item.templates:
                await app_helpers.insert_or_update_prompt_template_permissions(
                    db, role_uuid, item
                )
            else:
                await app_helpers.insert_or_update_prompt_permissions(
                    db, role_uuid, item.uuid, item.access
                )

    await db.flush()
    await db.commit()

    return schemas.SuccessReturn.success_instance()


@router.get(
    "/role/{role_uuid}/copilot-access", response_model=schemas.RoleCopilotAccess
)
async def get_role_copilot_access(
    role_uuid: UUID,
    db: AsyncSession = Depends(aget_read_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """Get the Copilot models and MCP tools that a role grants"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")

    return await app_helpers.get_role_copilot_access(db, [role_uuid])


@router.put("/role/{role_uuid}/copilot-access", response_model=schemas.SuccessReturn)
async def put_role_copilot_access(
    role_uuid: UUID,
    access: schemas.RoleCopilotAccess,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """Set the Copilot models and MCP tools that a role grants.

    The users of the role may use what their roles grant, and nothing else.
    """
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")

    await app_helpers.set_role_copilot_access(db, role_uuid, access)
    return schemas.SuccessReturn.success_instance()


@router.get(
    "/role-permissions/{role_uuid}", response_model=list[schemas.RolePermissions]
)
async def get_role_permissions(
    role_uuid: UUID,
    db: AsyncSession = Depends(aget_read_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """Get the permissions for a role"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")

    permissions = []
    # Get backend permissions
    permissions_backends = await db.execute(
        select(models.RoleBackend).where(models.RoleBackend.role_uuid == role_uuid)
    )
    permissions.extend(
        [
            schemas.RolePermissions(
                uuid=permission.backend_uuid,
                access=permission.access,
                widgets=permission.widgets,
                templates=permission.templates,
                type="backend",
                category="data-connectors",
            )
            for permission in permissions_backends.scalars()
        ]
    )

    # Get file permissions
    permissions_files = await db.execute(
        select(
            models.RoleFile.file_uuid,
            models.RoleFile.access,
            models.FileWidget.extension,
        )
        .join(models.FileWidget, models.RoleFile.file_uuid == models.FileWidget.uuid)
        .where(models.RoleFile.role_uuid == role_uuid)
    )

    permissions.extend(
        [
            schemas.RolePermissions(
                uuid=permission["file_uuid"],
                access=permission["access"],
                type="file",
                category="data-connectors",
                file_extension=permission["extension"],
            )
            for permission in permissions_files.mappings()
        ]
    )

    # Get prompt permissions
    permissions_prompts = await db.execute(
        select(
            models.RolePrompt.prompt_uuid,
            models.RolePrompt.access,
            models.UserPrompts.prompt,
        )
        .join(
            models.UserPrompts, models.RolePrompt.prompt_uuid == models.UserPrompts.uuid
        )
        .where(models.RolePrompt.role_uuid == role_uuid)
    )

    permissions.extend(
        [
            schemas.RolePermissions(
                uuid=permission["prompt_uuid"],
                access=permission["access"],
                type="prompt",
                category="prompts",
                prompt=permission["prompt"],
            )
            for permission in permissions_prompts.mappings()
        ]
    )
    return permissions


@router.get(
    "/role-permissions-audit-logs", response_model=list[schemas.RoleAuditLogReturn]
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_audit_logs(  # noqa: PLR0913, PLR0917
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    action: schemas.RoleAuditAction | None = Query(None),
    resource_type: schemas.RoleResourceType | None = Query(None),
    role_uuid: UUID | None = Query(None),
):
    """Retrieve audit logs for the entity"""
    # Get admin's entity
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)

    # Build query
    query = (
        select(
            models.AuditEntityRolesPermissions.uuid,
            models.AuditEntityRolesPermissions.created_date,
            models.AuditEntityRolesPermissions.entity_uuid,
            models.AuditEntityRolesPermissions.role_uuid,
            models.AuditEntityRolesPermissions.action,
            models.AuditEntityRolesPermissions.resource_type,
            models.AuditEntityRolesPermissions.resource_uuid,
            models.AuditEntityRolesPermissions.details,
            models.User.email.label("performed_by_email"),
            models.Role.name.label("role_name"),
        )
        .join(
            models.User,
            models.AuditEntityRolesPermissions.performed_by_uuid == models.User.uuid,
        )
        .join(
            models.Role,
            models.AuditEntityRolesPermissions.role_uuid == models.Role.uuid,
        )
        .where(models.AuditEntityRolesPermissions.entity_uuid == entity_uuid)
        .order_by(models.AuditEntityRolesPermissions.created_date.desc())
    )

    if start_date:
        query = query.where(
            models.AuditEntityRolesPermissions.created_date >= start_date
        )
    if end_date:
        query = query.where(models.AuditEntityRolesPermissions.created_date <= end_date)
    if action:
        query = query.where(models.AuditEntityRolesPermissions.action == action)
    if resource_type:
        query = query.where(
            models.AuditEntityRolesPermissions.resource_type == resource_type
        )
    if role_uuid:
        query = query.where(models.AuditEntityRolesPermissions.role_uuid == role_uuid)

    # Execute query
    results = await db.execute(query)

    # Transform results
    audit_logs = []
    for row in results.mappings():
        details_msg = None
        with suppress(Exception):
            details_msg = app_helpers.create_details_message(
                row["action"], row["resource_type"], row["details"]
            )

        audit_log = schemas.RoleAuditLogReturn(
            uuid=row["uuid"],
            created_at=row["created_date"],
            entity_uuid=row["entity_uuid"],
            role_uuid=row["role_uuid"],
            action=row["action"],
            resource_type=row["resource_type"],
            resource_uuid=row["resource_uuid"],
            performed_by_email=row["performed_by_email"],
            details=row["details"],
            details_msg=details_msg,
            role_name=row["role_name"],
        )
        audit_logs.append(audit_log)

    return audit_logs


@router.get(
    "/user-permissions/{user_uuid}", response_model=list[schemas.UserPermissions]
)
async def get_user_permissions(
    user_uuid: UUID,
    db: AsyncSession = Depends(aget_read_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """Get the permissions for a user"""
    await ensure_user_in_admin_entity(db, admin, user_uuid)
    user_role_permissions = await app_helpers.get_user_role_permissions(db, user_uuid)

    # Convert permissions dict to use role names as keys instead of UUIDs
    permissions_dict = user_role_permissions.model_dump().get("permissions", {})
    named_permissions = {}
    for role_uuid, role_data in permissions_dict.items():
        # Don't try to convert role_uuid to UUID again, it's already a string
        role_name = await app_helpers.get_role_name(db, role_uuid)
        named_permissions[role_name] = role_data
    user_role_permissions.permissions = named_permissions

    data_connectors = []
    templates = []
    prompts = []
    processed_backends = set()
    processed_files = set()
    processed_templates = set()
    processed_prompts = set()

    for role_name, role_data in (
        user_role_permissions.model_dump().get("permissions", {}).items()
    ):
        for backend in role_data.get("backends", []):
            await app_helpers.process_backend(
                role_name, backend, data_connectors, processed_backends
            )
            await app_helpers.process_templates(
                role_name,
                backend,
                processed_templates,
                templates,
                prompts,  # Pass prompts list
                processed_prompts,  # Pass processed prompts set
            )

        for file in role_data.get("files", []):
            await app_helpers.process_file(
                role_name, file, data_connectors, processed_files
            )

        # Process standalone prompts
        await app_helpers.process_prompts(
            role_name, role_data.get("prompts", []), processed_prompts, prompts
        )

    # Add final_permission to all resources
    await app_helpers.add_final_permissions_to_resources(
        data_connectors, templates, prompts
    )

    return [
        schemas.UserPermissions(
            data_connectors=data_connectors, templates=templates, prompts=prompts
        )
    ]


@router.patch("/theme-settings", response_model=schemas.SuccessReturn)
async def patch_theme_settings(
    settings: schemas.EntityThemeSettings,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_admin),
):
    """Update the theme settings for the entity"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    existing = (
        await db.execute(
            select(models.EntityThemeSettings).where(
                models.EntityThemeSettings.entity_uuid == entity_uuid
            )
        )
    ).scalar_one_or_none()

    adjusted_settings = settings.model_dump(exclude_unset=True)
    if existing:
        setattr(existing, "settings", adjusted_settings)
    else:
        new_settings = models.EntityThemeSettings(
            entity_uuid=entity_uuid, settings=adjusted_settings
        )
        db.add(new_settings)

    await db.commit()
    return schemas.SuccessReturn.success_instance()


async def get_admin_share_request(
    db: AsyncSession, admin: Row, request_uuid: UUID
) -> models.ShareRequest:
    "A share request of a developer of the admin's organization."
    entity_uuid = await get_admin_entity(db, admin.permissions_uuid)
    query = (
        select(models.ShareRequest)
        .join(User, User.uuid == models.ShareRequest.requester_uuid)
        .join(PermissionsEntityMap, PermissionsEntityMap.uuid == User.permissions_uuid)
        .where(
            models.ShareRequest.uuid == request_uuid,
            PermissionsEntityMap.entity_uuid == entity_uuid,
        )
    )
    share_request = (await db.execute(query)).scalar_one_or_none()
    if share_request is None:
        raise HTTPException(404, detail="Share request not found")
    return share_request


async def share_request_users(
    db: AsyncSession, share_requests: list[models.ShareRequest]
) -> dict[UUID, schemas.ShareRequestUser]:
    "The requesters and recipients of the share requests."
    user_uuids = {r.requester_uuid for r in share_requests} | {
        r.recipient_uuid for r in share_requests if r.recipient_uuid
    }
    query = select(User.uuid, User.email, User.first_name, User.last_name).where(
        User.uuid.in_(user_uuids)
    )
    return {
        user.uuid: schemas.ShareRequestUser(
            email=user.email, first_name=user.first_name, last_name=user.last_name
        )
        for user in (await db.execute(query)).all()
    }


async def share_request_item_names(
    db: AsyncSession, share_requests: list[models.ShareRequest]
) -> dict[UUID, str]:
    "The names of the dashboards and apps of the share requests."
    dashboards_query = select(
        models.DashboardItem.uuid, models.DashboardItem.content
    ).where(
        models.DashboardItem.uuid.in_(
            [r.dashboard_item_uuid for r in share_requests if r.dashboard_item_uuid]
        )
    )
    apps_query = select(models.UserApp.uuid, models.UserApp.content).where(
        models.UserApp.uuid.in_(
            [r.user_app_uuid for r in share_requests if r.user_app_uuid]
        )
    )
    # A dashboard's name is in its tab data
    names = {
        uuid: ((content or {}).get("data") or {}).get("name")
        or (content or {}).get("name")
        or ""
        for uuid, content in (await db.execute(dashboards_query)).all()
    }
    names.update(
        (uuid, (content or {}).get("name") or "")
        for uuid, content in (await db.execute(apps_query)).all()
    )
    return names


@router.get("/share-requests", response_model=list[schemas.ShareRequestReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_share_requests(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """The shares that developers of the admin's organization wait to have approved,
    oldest first."""
    entity_uuid = await get_admin_entity(db, admin.permissions_uuid)
    query = (
        select(models.ShareRequest)
        .join(User, User.uuid == models.ShareRequest.requester_uuid)
        .join(PermissionsEntityMap, PermissionsEntityMap.uuid == User.permissions_uuid)
        .where(PermissionsEntityMap.entity_uuid == entity_uuid)
        .order_by(models.ShareRequest.created_date)
    )
    share_requests = list((await db.execute(query)).scalars().all())
    users = await share_request_users(db, share_requests)
    names = await share_request_item_names(db, share_requests)

    return [
        schemas.ShareRequestReturn(
            uuid=r.uuid,
            created_date=r.created_date,
            requester=users[r.requester_uuid],
            item_type="dashboard" if r.dashboard_item_uuid else "app",
            item_uuid=r.dashboard_item_uuid or r.user_app_uuid,
            item_name=names.get(r.dashboard_item_uuid or r.user_app_uuid, ""),
            recipient=users[r.recipient_uuid] if r.recipient_uuid else None,
            permissions=r.permissions,
        )
        for r in share_requests
    ]


@router.post("/share-requests/{request_uuid}/approve", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def approve_share_request(
    request: Request,
    request_uuid: UUID,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """Makes the share the developer asked for: the recipient, or with no recipient the
    whole organization, gets the dashboard or app."""
    share_request = await get_admin_share_request(db, admin, request_uuid)
    await crud.approve_share_request(db, share_request)
    return SuccessReturn.success_instance()


@router.post("/share-requests/{request_uuid}/decline", response_model=SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def decline_share_request(
    request: Request,
    request_uuid: UUID,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    "Drops the share the developer asked for; nobody gets the item."
    share_request = await get_admin_share_request(db, admin, request_uuid)
    await db.execute(
        delete(models.ShareRequest).where(
            models.ShareRequest.uuid == share_request.uuid
        )
    )
    await db.commit()
    return SuccessReturn.success_instance()
