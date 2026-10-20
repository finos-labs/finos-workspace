"""What the superuser's routes (/entity, /admin) and the admin CLI (scripts/workspace_admin.py)
do to entities, entity types, users and data backends. The routes check who may do it; these
functions do it. A refusal is an HTTPException: the routes answer with it, the CLI prints it.
"""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Select, delete, insert, select, update
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, crud, models, schemas
from api.base import clean_email, get_now, random_password
from api.models import Entity, EntityType, PermissionsEntityMap, User, UserInvite, UserRole
from api.notifications import notify_admins
from routers import app_helpers
from utilities.config import settings

# --- Entity types ---------------------------------------------------------------------


async def create_entity_type(
    db: AsyncSession, entity_type: schemas.EntityTypeCreate
) -> None:
    try:
        await db.execute(
            insert(EntityType).values(
                entity_type=entity_type.entity_type,
                code=entity_type.code,
                active=entity_type.active,
                permission_hierarchy=entity_type.permission_hierarchy,
            )
        )
        await db.commit()
    except IntegrityError as exc:
        raise HTTPException(409, detail="Entity type already exists") from exc
    except DataError as exc:
        raise HTTPException(400, detail="Bad data submitted") from exc


def entity_types_query() -> Select:
    return select(
        EntityType.entity_type,
        EntityType.code,
        EntityType.active,
        EntityType.permission_hierarchy,
        EntityType.uuid,
    )


# --- Entities -------------------------------------------------------------------------


def _conflict(exc: IntegrityError) -> HTTPException:
    detail = (
        exc.orig.args[1] if exc.orig.args and len(exc.orig.args) > 1 else "Invalid code"
    )
    return HTTPException(409, detail=detail)


async def create_entity(
    db: AsyncSession, entity: schemas.EntityPost
) -> schemas.AddEntityReturn:
    """The entity, with its three user types, the admin's first."""
    try:
        response = await db.execute(
            insert(Entity).values(
                name=entity.name,
                entity_type_uuid=entity.entity_code,
                email=entity.email,
                company_type=entity.company_type,
                organization_size=entity.organization_size,
                aum=entity.aum,
                country=entity.country,
                sharing_enabled=entity.sharing_enabled,
            )
        )
        entity_uuid = response.inserted_primary_key[0]
    except IntegrityError as exc:
        raise _conflict(exc) from exc

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
    db: AsyncSession, entity_uuid: UUID, entity: schemas.EntityBase
) -> None:
    """Switching sharing off revokes the shares of the entity's users."""
    sharing_query = select(Entity.sharing_enabled).where(Entity.uuid == entity_uuid)
    sharing_was_enabled = (await db.execute(sharing_query)).scalar_one_or_none()
    query = (
        update(Entity)
        .where(Entity.uuid == entity_uuid)
        .values(
            name=entity.name,
            entity_type_uuid=entity.entity_code,
            email=entity.email,
            company_type=entity.company_type,
            organization_size=entity.organization_size,
            aum=entity.aum,
            country=entity.country,
            sharing_enabled=entity.sharing_enabled,
        )
    )
    try:
        response = await db.execute(query)
        await db.commit()
        if response.rowcount == 0:  # type: ignore
            raise HTTPException(404, detail="Entity not found")
    except IntegrityError as exc:
        raise _conflict(exc) from exc

    if sharing_was_enabled and not entity.sharing_enabled:
        await crud.revoke_disallowed_shares(
            db, list(await app_helpers.get_entity_users(db, entity_uuid))
        )


def entities_query() -> Select:
    return (
        select(
            Entity.uuid,
            Entity.name,
            EntityType,
            Entity.email,
            Entity.company_type,
            Entity.organization_size,
            Entity.aum,
            Entity.country,
            Entity.sharing_enabled,
        )
        .select_from(Entity)
        .join(EntityType, Entity.entity_type_uuid == EntityType.uuid)
    )


def entity_return(item) -> schemas.EntityReturn:
    """An entity as entities_query() selects it."""
    return schemas.EntityReturn(
        uuid=item.uuid,
        name=item.name,
        entity_type=item[2].__dict__,
        email=item.email,
        company_type=item.company_type,
        organization_size=item.organization_size,
        aum=item.aum,
        country=item.country,
        sharing_enabled=item.sharing_enabled,
    )


async def delete_entity(db: AsyncSession, entity_uuid: UUID) -> None:
    """Only an entity without users."""
    if await app_helpers.get_entity_users(db, entity_uuid):
        raise HTTPException(
            status_code=400, detail="Cannot delete entity with existing users"
        )
    result = await db.execute(
        delete(models.Entity).where(models.Entity.uuid == entity_uuid)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Entity not found")
    await db.commit()


# --- Users ----------------------------------------------------------------------------


async def password_reset_link(user_uuid: UUID) -> schemas.PasswordResetLink:
    """The link the administrator gives the user to set their password with, at the web
    app's address. It works once, within a day; a newer link replaces it."""
    token = await auth_helpers.issue_password_reset(user_uuid)
    return schemas.PasswordResetLink(
        success=True,
        link=f"{settings.APPURL.rstrip('/')}/reset-password#{token}",
        expires_at=get_now() + auth_helpers.PASSWORD_RESET_LIFETIME,
    )


async def create_user(
    db: AsyncSession, user: schemas.UserCreateAdmin, entity_uuid: UUID
) -> schemas.PasswordResetLink:
    """A user of the entity whose map `user.permissions_uuid` is, if they are not registered
    or invited yet, with a random password nobody knows; the answer is the link with which
    they set theirs."""
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
    await db.commit()
    if user.role:
        await app_helpers.roles_changed(db, [user_uuid])
    return await password_reset_link(user_uuid)


async def reset_password(db: AsyncSession, user_uuid: UUID) -> schemas.PasswordResetLink:
    """The password stops working, every session of the user ends, and the answer is the
    link with which the user sets a new one."""
    # A random password nobody knows, until the user sets theirs with the link
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
    """The user leaves their entity, of the given maps only when `maps` is given: their
    shares and the dashboards' entity go with it, and they leave its roles. They are no
    user any more: every session of theirs ends, and they cannot sign in."""
    query = update(User).where(User.uuid == user_uuid).values(permissions_uuid=None)
    if maps is not None:
        query = query.where(User.permissions_uuid.in_(maps))
    # Nothing of a user outside the organization is touched
    if (await db.execute(query)).rowcount == 0:
        raise HTTPException(404, detail="Matching user not found")

    await crud.remove_shares_both_ways(db, user_uuid)
    await crud.update_user_dashboards_new_entity(db, user_uuid)
    await db.execute(delete(models.Session).where(models.Session.user_uuid == user_uuid))
    await db.commit()
    await app_helpers.left_organization(db, user_uuid)


async def move_user(db: AsyncSession, user_uuid: UUID, permissions_uuid: UUID) -> None:
    """The user takes the user type `permissions_uuid` is, of its entity. Leaving an entity
    takes their shares and roles with it; every web session of the user ends."""
    old_entity_query = (
        select(PermissionsEntityMap.entity_uuid)
        .join(User, User.permissions_uuid == PermissionsEntityMap.uuid)
        .where(User.uuid == user_uuid)
    )
    old_entity_uuid = (await db.execute(old_entity_query)).scalar_one_or_none()
    new_entity_query = select(PermissionsEntityMap.entity_uuid).where(
        PermissionsEntityMap.uuid == permissions_uuid
    )
    new_entity_uuid = (await db.execute(new_entity_query)).scalar_one_or_none()
    response = await db.execute(
        update(User).where(User.uuid == user_uuid).values(permissions_uuid=permissions_uuid)
    )
    await db.commit()
    if response.rowcount == 0:  # type: ignore
        raise HTTPException(404, detail="User not found")
    # A user's type sets their limits (a developer has none)
    app_helpers.invalidate_usage_cache(user_uuid)

    if old_entity_uuid != new_entity_uuid:
        await crud.remove_shares_both_ways(db, user_uuid)
        await crud.update_user_dashboards_new_entity(db, user_uuid, new_entity_uuid)
        await app_helpers.left_organization(db, user_uuid)

    await auth_helpers.delete_user_app_sessions(db, user_uuid, ["app", "oauth-app"])


def users_query(email: str = "") -> Select:
    query = select(User.uuid, User.email, User.permissions_uuid)
    return query.where(User.email.contains(email)) if email else query


async def user_return(db: AsyncSession, item) -> schemas.EntityUserReturn:
    """A user as users_query() selects them, with their user type and its entity."""
    permissions_query = (
        select(PermissionsEntityMap)
        .where(PermissionsEntityMap.uuid == item.permissions_uuid)
        .limit(1)
    )
    permissions = (await db.execute(permissions_query)).scalar_one_or_none()
    return schemas.EntityUserReturn(
        uuid=item.uuid, email=item.email, permissions=permissions
    )


# --- Data backends --------------------------------------------------------------------


async def add_data_backend(
    db: AsyncSession, entity_uuid: UUID, data_backend: schemas.CreateApiSource
) -> None:
    await db.execute(
        insert(models.ApiSource).values(
            **data_backend.model_dump(), entity_uuid=entity_uuid
        )
    )
    await db.commit()


async def delete_data_backend(
    db: AsyncSession, entity_uuid: UUID, backend_name: str
) -> None:
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
    query = select(models.ApiSource).where(models.ApiSource.entity_uuid == entity_uuid)
    return list((await db.execute(query)).scalars().all())
