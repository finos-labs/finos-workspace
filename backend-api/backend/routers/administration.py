import re
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Select, delete, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, crud, models, schemas
from api.base import clean_email, get_now, random_password, random_string
from api.models import Entity, PermissionsEntityMap, User, UserInvite, UserRole
from api.notifications import notify_admins
from routers import app_helpers
from utilities.config import settings

NAME_TAKEN = HTTPException(409, detail="An entity with this name already exists")
REMOVED_PREFIX = re.compile(r"^deleted-[0-9A-Za-z]{4}-")


async def create_entity(
    db: AsyncSession, entity: schemas.EntityPost
) -> schemas.AddEntityReturn:
    try:
        response = await db.execute(
            insert(Entity).values(name=entity.name, sharing_enabled=entity.sharing_enabled)
        )
        entity_uuid = response.inserted_primary_key[0]
    except IntegrityError as exc:
        raise NAME_TAKEN from exc

    admin_map = await db.execute(
        insert(PermissionsEntityMap).values(name=models.ADMIN_TYPE, entity_uuid=entity_uuid)
    )
    await db.execute(
        insert(PermissionsEntityMap),
        [
            {"entity_uuid": entity_uuid, "name": user_type}
            for user_type in (models.DEVELOPER_TYPE, models.USER_TYPE)
        ],
    )
    await app_helpers.create_default_roles(db, entity_uuid)
    await db.commit()
    return schemas.AddEntityReturn(
        entity_uuid=entity_uuid, permission_map_uuid=admin_map.inserted_primary_key[0]
    )


async def notify_entity_created(entity: schemas.EntityPost) -> None:
    await notify_admins(
        "entity.created",
        f"New entity: {entity.name}",
        f"The entity {entity.name} was created with {entity.admin_email} as its admin.",
        {"entity_name": entity.name, "admin_email": entity.admin_email},
    )


async def update_entity(
    db: AsyncSession, entity_uuid: UUID, entity: schemas.EntityUpdate
) -> None:
    sharing_query = select(Entity.sharing_enabled).where(
        Entity.uuid == entity_uuid, Entity.deleted_at.is_(None)
    )
    sharing_was_enabled = (await db.execute(sharing_query)).scalar_one_or_none()
    values: dict = {"name": entity.name, "sharing_enabled": entity.sharing_enabled}
    if entity.disabled is not None:
        values["disabled"] = entity.disabled
    if entity.disabled:
        await check_entity_has_no_superuser(db, entity_uuid)
    query = (
        update(Entity)
        .where(Entity.uuid == entity_uuid, Entity.deleted_at.is_(None))
        .values(**values)
    )
    try:
        response = await db.execute(query)
        await db.commit()
        if response.rowcount == 0:  # type: ignore
            raise HTTPException(404, detail="Entity not found")
    except IntegrityError as exc:
        raise NAME_TAKEN from exc

    if sharing_was_enabled and not entity.sharing_enabled:
        await crud.revoke_disallowed_shares(
            db, list(await app_helpers.get_entity_users(db, entity_uuid))
        )
    if entity.disabled:
        await end_entity_sessions(db, entity_uuid)


async def check_entity_has_no_superuser(db: AsyncSession, entity_uuid: UUID) -> None:
    query = (
        select(User.uuid)
        .join(PermissionsEntityMap, PermissionsEntityMap.uuid == User.permissions_uuid)
        .where(
            PermissionsEntityMap.entity_uuid == entity_uuid,
            User.is_superuser.is_(True),
        )
        .limit(1)
    )
    if (await db.execute(query)).first():
        raise HTTPException(
            409, detail="Cannot disable an entity that has a superuser"
        )


async def end_entity_sessions(db: AsyncSession, entity_uuid: UUID) -> None:
    users = await app_helpers.get_entity_users(db, entity_uuid)
    sessions = (
        await db.execute(
            select(models.Session.uuid).where(models.Session.user_uuid.in_(users))
        )
    ).scalars().all()
    await db.execute(
        delete(models.Session).where(models.Session.user_uuid.in_(users))
    )
    await db.commit()
    for session_uuid in sessions:
        await auth_helpers.revoke_agent_tokens(session_uuid)


def entities_query(removed: bool = False) -> Select:
    return (
        select(
            Entity.uuid,
            Entity.name,
            Entity.sharing_enabled,
            Entity.disabled,
            Entity.deleted_at,
        )
        .where(Entity.deleted_at.is_not(None) if removed else Entity.deleted_at.is_(None))
        .order_by(Entity.name)
    )


def entity_return(item) -> schemas.EntityReturn:
    return schemas.EntityReturn(
        uuid=item.uuid,
        name=REMOVED_PREFIX.sub("", item.name) if item.deleted_at else item.name,
        sharing_enabled=item.sharing_enabled,
        disabled=item.disabled,
    )


async def delete_entity(db: AsyncSession, entity_uuid: UUID) -> None:
    name = (
        await db.execute(
            select(Entity.name).where(
                Entity.uuid == entity_uuid, Entity.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if name is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    if await app_helpers.get_entity_users(db, entity_uuid):
        raise HTTPException(
            status_code=400, detail="Cannot delete entity with existing users"
        )
    await db.execute(
        delete(UserInvite).where(
            UserInvite.used.is_(False),
            UserInvite.permissions_uuid.in_(
                select(PermissionsEntityMap.uuid).where(
                    PermissionsEntityMap.entity_uuid == entity_uuid
                )
            ),
        )
    )
    await db.execute(
        update(Entity)
        .where(Entity.uuid == entity_uuid)
        .values(
            name=f"deleted-{random_string(4)}-{name}"[:100],
            deleted_at=get_now(),
        )
    )
    await db.commit()


async def restore_entity(
    db: AsyncSession, entity_uuid: UUID, name: str | None = None
) -> None:
    current = (
        await db.execute(
            select(Entity.name).where(
                Entity.uuid == entity_uuid, Entity.deleted_at.is_not(None)
            )
        )
    ).scalar_one_or_none()
    if current is None:
        raise HTTPException(404, detail="Entity not found")
    try:
        await db.execute(
            update(Entity)
            .where(Entity.uuid == entity_uuid)
            .values(name=name or REMOVED_PREFIX.sub("", current), deleted_at=None)
        )
        await db.commit()
    except IntegrityError as exc:
        raise NAME_TAKEN from exc


async def check_entity_active(db: AsyncSession, entity_uuid: UUID) -> None:
    query = select(Entity.uuid).where(
        Entity.uuid == entity_uuid, Entity.deleted_at.is_(None)
    )
    if (await db.execute(query)).first() is None:
        raise HTTPException(404, detail="Entity not found")


async def check_map_entity_active(db: AsyncSession, permissions_uuid: UUID) -> None:
    query = (
        select(PermissionsEntityMap.uuid)
        .join(Entity, Entity.uuid == PermissionsEntityMap.entity_uuid)
        .where(PermissionsEntityMap.uuid == permissions_uuid, Entity.deleted_at.is_(None))
    )
    if (await db.execute(query)).first() is None:
        raise HTTPException(404, detail="Permission map not found")


async def password_reset_link(user_uuid: UUID) -> schemas.PasswordResetLink:
    token = await auth_helpers.issue_password_reset(user_uuid)
    return schemas.PasswordResetLink(
        success=True,
        link=f"{settings.APPURL.rstrip('/')}/reset-password#{token}",
        expires_at=get_now() + auth_helpers.PASSWORD_RESET_LIFETIME,
    )


async def create_user(
    db: AsyncSession, user: schemas.UserCreateAdmin, entity_uuid: UUID
) -> schemas.PasswordResetLink:
    if user.role and not await app_helpers.role_exists(db, user.role, entity_uuid):
        raise HTTPException(404, detail="Role not found")

    invite_query = select(UserInvite.uuid).where(UserInvite.email == user.email)
    if (await db.execute(invite_query)).first():
        raise HTTPException(409, detail="User is already invited")
    if await crud.check_new_user(db, user.email):
        raise HTTPException(409, detail="A user with this email already exists")

    response = await db.execute(
        insert(User).values(
            email=user.email,
            clean_email=clean_email(user.email),
            permissions_uuid=user.permissions_uuid,
            password=random_password(),
            first_name=user.first_name,
            last_name=user.last_name,
            app_start=get_now(),
            confirmed=1,
        )
    )
    if response.rowcount == 0:
        raise HTTPException(404, detail="User was not created")
    user_uuid = response.inserted_primary_key[0]

    if role := user.role:
        await db.execute(insert(UserRole).values(user_uuid=user_uuid, role_uuid=role))
    await app_helpers.give_default_roles(
        db, user_uuid, user.permissions_uuid, [app_helpers.AGENT_USER_ROLE]
    )
    await db.commit()
    await app_helpers.roles_changed(db, [user_uuid])
    return await password_reset_link(user_uuid)


async def reset_password(db: AsyncSession, user_uuid: UUID) -> schemas.PasswordResetLink:
    update_query = (
        update(User)
        .where(User.uuid == user_uuid, User.deleted.is_(False))
        .values(password=random_password())
    )
    if (await db.execute(update_query)).rowcount == 0:
        raise HTTPException(404, detail="Matching user not found")
    await db.execute(delete(models.Session).where(models.Session.user_uuid == user_uuid))
    await db.commit()
    return await password_reset_link(user_uuid)


async def remove_from_entity(
    db: AsyncSession, user_uuid: UUID, maps: list[UUID] | None = None
) -> None:
    query = update(User).where(User.uuid == user_uuid).values(permissions_uuid=None)
    if maps is not None:
        query = query.where(User.permissions_uuid.in_(maps))
    if (await db.execute(query)).rowcount == 0:
        raise HTTPException(404, detail="Matching user not found")

    await crud.remove_shares_both_ways(db, user_uuid)
    await crud.update_user_dashboards_new_entity(db, user_uuid)
    await db.execute(delete(models.Session).where(models.Session.user_uuid == user_uuid))
    await db.commit()
    await app_helpers.left_organization(db, user_uuid)


async def move_user(db: AsyncSession, user_uuid: UUID, permissions_uuid: UUID) -> None:
    old_entity_query = (
        select(PermissionsEntityMap.entity_uuid)
        .join(User, User.permissions_uuid == PermissionsEntityMap.uuid)
        .where(User.uuid == user_uuid)
    )
    old_entity_uuid = (await db.execute(old_entity_query)).scalar_one_or_none()
    new_entity_query = (
        select(PermissionsEntityMap.entity_uuid)
        .join(Entity, Entity.uuid == PermissionsEntityMap.entity_uuid)
        .where(
            PermissionsEntityMap.uuid == permissions_uuid, Entity.deleted_at.is_(None)
        )
    )
    new_entity_uuid = (await db.execute(new_entity_query)).scalar_one_or_none()
    if new_entity_uuid is None:
        raise HTTPException(404, detail="Permission map not found")
    response = await db.execute(
        update(User)
        .where(User.uuid == user_uuid, User.deleted.is_(False))
        .values(permissions_uuid=permissions_uuid)
    )
    await db.commit()
    if response.rowcount == 0:  # type: ignore
        raise HTTPException(404, detail="User not found")
    app_helpers.invalidate_usage_cache(user_uuid)

    if old_entity_uuid != new_entity_uuid:
        await crud.remove_shares_both_ways(db, user_uuid)
        await crud.update_user_dashboards_new_entity(db, user_uuid, new_entity_uuid)
        await app_helpers.left_organization(db, user_uuid)
        await app_helpers.give_default_roles(
            db, user_uuid, permissions_uuid, [app_helpers.AGENT_USER_ROLE]
        )
        await db.commit()
        await app_helpers.roles_changed(db, [user_uuid])

    await auth_helpers.delete_user_app_sessions(db, user_uuid, ["app", "oauth-app"])


def users_query(email: str = "") -> Select:
    query = (
        select(User.uuid, User.email, User.permissions_uuid)
        .where(User.deleted.is_(False))
        .order_by(User.email)
    )
    return query.where(User.email.contains(email)) if email else query


async def user_return(db: AsyncSession, item) -> schemas.EntityUserReturn:
    permissions_query = (
        select(PermissionsEntityMap)
        .where(PermissionsEntityMap.uuid == item.permissions_uuid)
        .limit(1)
    )
    permissions = (await db.execute(permissions_query)).scalar_one_or_none()
    return schemas.EntityUserReturn(
        uuid=item.uuid, email=item.email, permissions=permissions
    )


async def add_data_backend(
    db: AsyncSession, entity_uuid: UUID, data_backend: schemas.CreateApiSource
) -> None:
    await check_entity_active(db, entity_uuid)
    await db.execute(
        insert(models.ApiSource).values(
            **data_backend.model_dump(), entity_uuid=entity_uuid
        )
    )
    await db.commit()


async def delete_data_backend(
    db: AsyncSession, entity_uuid: UUID, backend_name: str
) -> None:
    await check_entity_active(db, entity_uuid)
    result = await db.execute(
        delete(models.ApiSource).where(
            models.ApiSource.entity_uuid == entity_uuid,
            models.ApiSource.name == backend_name,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Data backend not found")
    await db.commit()


async def data_backends(db: AsyncSession, entity_uuid: UUID) -> list[models.ApiSource]:
    await check_entity_active(db, entity_uuid)
    query = select(models.ApiSource).where(models.ApiSource.entity_uuid == entity_uuid)
    return list((await db.execute(query)).scalars().all())
