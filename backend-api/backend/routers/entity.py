"""Entity routes"""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi_pagination import Page
from fastapi_pagination.customization import CustomizedPage, UseParamsFields
from fastapi_pagination.ext.sqlalchemy import paginate
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, crud, models, schemas
from api.database import aget_read_db, aget_write_db
from api.models import (
    Entity,
    EntityType,
    PermissionsEntityMap,
    User,
)
from api.notifications import notify_admins
from api.rate_limit import LIMIT_DEFAULT, exempt_service_token, limiter
from routers import app_helpers, routers_helpers

router = APIRouter(prefix="/entity", tags=["entity"])

CustomPage = CustomizedPage[Page, UseParamsFields(size=Query(100, ge=1, le=1000))]


@router.get("/validate", response_model=schemas.SuccessReturn)
async def validate_entity_admin(
    _=Depends(auth_helpers.get_current_superuser),
):
    """Frontend visibility probe for entity management: 200 for superusers, 401 otherwise."""
    return schemas.SuccessReturn.success_instance()


@router.post("/entity-type", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def add_entity_type(
    request: Request,
    entity_type: schemas.EntityTypeCreate,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    try:
        query = insert(EntityType).values(
            entity_type=entity_type.entity_type,
            code=entity_type.code,
            active=entity_type.active,
            permission_hierarchy=entity_type.permission_hierarchy,
        )
        await db.execute(query)
        await db.commit()
        return {"success": True}
    except IntegrityError as exc:
        raise HTTPException(409, detail="Entity type already exists") from exc
    except DataError as exc:
        raise HTTPException(400, detail="Bad data submitted") from exc


@router.put("/entity-type/{type_uuid}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_entity_type(
    type_uuid: UUID,
    request: Request,
    entity_type: schemas.EntityTypeCreate,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    try:
        query = (
            update(EntityType)
            .where(EntityType.uuid == type_uuid)
            .values(**entity_type.model_dump())
        )
        response = await db.execute(query)
        await db.commit()
        if response.rowcount == 0:  # type: ignore
            raise HTTPException(404, detail="Entity type not found")
    except IntegrityError as exc:
        raise HTTPException(409, detail="Entity type already exists") from exc
    except DataError as exc:
        raise HTTPException(400, detail="Bad data submitted") from exc
    return {"success": True}


@router.get("/entity-type", response_model=CustomPage[schemas.EntityTypeReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_entity_types(
    request: Request,
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    query = select(
        EntityType.entity_type,
        EntityType.code,
        EntityType.active,
        EntityType.permission_hierarchy,
        EntityType.uuid,
    )
    return await paginate(db, query)


@router.post("/entity", response_model=schemas.AddEntityReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def add_entity(
    request: Request,
    entity: schemas.EntityPost,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    try:
        query = insert(Entity).values(
            name=entity.name,
            entity_type_uuid=entity.entity_code,
            email=entity.email,
            company_type=entity.company_type,
            organization_size=entity.organization_size,
            aum=entity.aum,
            country=entity.country,
            sharing_enabled=entity.sharing_enabled,
        )
        response = await db.execute(query)
        entity_uuid = response.inserted_primary_key[0]
    except IntegrityError as exc:
        detail = (
            exc.orig.args[1]
            if exc.orig.args and len(exc.orig.args) > 1
            else "Invalid code"
        )
        raise HTTPException(409, detail=detail) from exc

    # Create the user types of the entity, the admin first
    i_query = insert(PermissionsEntityMap).values(
        name=models.ADMIN_TYPE,
        entity_uuid=entity_uuid,
    )
    result = await db.execute(i_query)
    await db.execute(
        insert(PermissionsEntityMap),
        [
            {"entity_uuid": entity_uuid, "name": user_type}
            for user_type in (models.DEVELOPER_TYPE, models.USER_TYPE)
        ],
    )

    await db.commit()
    background_tasks.add_task(
        notify_admins,
        "entity.created",
        f"New entity: {entity.name}",
        f"The entity {entity.name} was created with {entity.admin_email} as its admin.",
        {"entity_name": entity.name, "admin_email": entity.admin_email},
    )
    return {
        "entity_uuid": entity_uuid,
        "permission_map_uuid": result.inserted_primary_key[0],
    }


@router.put("/entity/{entity_uuid}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_entity(
    entity_uuid: UUID,
    request: Request,
    entity: schemas.EntityBase,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
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
        detail = (
            exc.orig.args[1]
            if exc.orig.args and len(exc.orig.args) > 1
            else "Invalid code"
        )
        raise HTTPException(409, detail=detail) from exc

    # Switching sharing off revokes the shares of the entity's users
    if sharing_was_enabled and not entity.sharing_enabled:
        await crud.revoke_disallowed_shares(
            db, list(await app_helpers.get_entity_users(db, entity_uuid))
        )
    return {"success": True}


@router.get("/entity", response_model=CustomPage[schemas.EntityReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_entities(
    request: Request,
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    def transformer(items: list[Entity]):
        cleaned = []
        for item in items:
            temp = schemas.EntityReturn(
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
            cleaned.append(temp)
        return cleaned

    query = (
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
    return await paginate(db, query, transformer=transformer)


@router.post("/entity-relationship", response_model=schemas.EntityRelationshipReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def add_entity_relationship(
    request: Request,
    entity: schemas.EntityRelationshipGet,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    schema = schemas.EntityRelationshipCreate(
        parent_uuid=entity.parent_uuid, child_uuid=entity.child_uuid
    )
    # We are keeping this for now, because this has more complicated logic
    return await crud.create_entity_relationship(db, schema)


@router.put("/entity-relationship/{er_uuid}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_entity_relationship(
    er_uuid: UUID,
    request: Request,
    entity: schemas.EntityRelationshipGet,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    try:
        query = (
            update(models.EntityRelationship)
            .where(models.EntityRelationship.uuid == er_uuid)
            .values(parent_uuid=entity.parent_uuid, child_uuid=entity.child_uuid)
        )
        response = await db.execute(query)
        await db.commit()
        if response.rowcount == 0:  # type: ignore
            raise HTTPException(404, detail="Entity relationship not found")
    except IntegrityError as exc:
        raise HTTPException(
            404, detail="Parent or child relatiosnhip not found"
        ) from exc
    return schemas.SuccessReturn.success_instance()


@router.get(
    "/entity-relationship", response_model=CustomPage[schemas.EntityRelationshipReturn]
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_entity_relationships(
    request: Request,
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    query = select(models.EntityRelationship)
    return await paginate(db, query)


async def check_entity_map_free(
    db: AsyncSession, entity_map: schemas.EntityMapCreate, map_uuid: UUID | None = None
) -> None:
    "An organization has one map of each user type."
    query = select(PermissionsEntityMap.uuid).where(
        PermissionsEntityMap.entity_uuid == entity_map.entity_uuid,
        PermissionsEntityMap.name == entity_map.name,
    )
    if map_uuid:
        query = query.where(PermissionsEntityMap.uuid != map_uuid)
    if (await db.execute(query.limit(1))).first():
        raise HTTPException(
            409, detail=f"The organization already has a {entity_map.name} map"
        )


@router.post("/entity-map", response_model=schemas.UUIDReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def add_entity_map(
    request: Request,
    entity_map: schemas.EntityMapCreate,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    await check_entity_map_free(db, entity_map)
    query = insert(PermissionsEntityMap).values(
        entity_uuid=entity_map.entity_uuid,
        name=entity_map.name,
    )
    response = await db.execute(query)
    if response.rowcount == 0:  # type: ignore
        raise HTTPException(404, detail="Map not found")
    await db.commit()
    return {"uuid": response.inserted_primary_key[0]}


@router.put("/entity-map/{map_uuid}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_entity_map(
    map_uuid: UUID,
    request: Request,
    entity_map: schemas.EntityMapCreate,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    await check_entity_map_free(db, entity_map, map_uuid)
    query = (
        update(PermissionsEntityMap)
        .where(PermissionsEntityMap.uuid == map_uuid)
        .values(
            entity_uuid=entity_map.entity_uuid,
            name=entity_map.name,
        )
    )
    try:
        response = await db.execute(query)
        if response.rowcount == 0:  # type: ignore
            raise HTTPException(404, detail="Map not found")
    except IntegrityError as exc:
        raise HTTPException(409, detail="Entity type already exists") from exc
    except DataError as exc:
        raise HTTPException(400, detail="Bad data submitted") from exc
    await db.commit()
    return {"success": True}


@router.get("/entity-map", response_model=CustomPage[schemas.EntityMapReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_entity_maps(
    request: Request,
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    query = select(PermissionsEntityMap)
    return await paginate(db, query)


@router.post("/register-admin", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def register_admin(
    request: Request,
    user: schemas.UserCreateAdmin,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    "Allows an admin to register a new user"
    extra_info = schemas.RegisterAppUser(inviting_uuid=admin.uuid)
    result = await routers_helpers.register_app_user(db, user, extra_info)
    return schemas.SuccessReturn.from_bool(result)


@router.put("/user/{user_uuid}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_user(
    user_uuid: UUID,
    request: Request,
    user: schemas.UserUpdateAdmin,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    # Old entity
    old_entity_query = (
        select(PermissionsEntityMap.entity_uuid)
        .join(User, User.permissions_uuid == PermissionsEntityMap.uuid)
        .where(User.uuid == user_uuid)
    )
    old_entity_uuid = (await db.execute(old_entity_query)).scalar_one_or_none()
    new_entity_query = select(PermissionsEntityMap.entity_uuid).where(
        PermissionsEntityMap.uuid == user.permissions_uuid
    )
    new_entity_uuid = (await db.execute(new_entity_query)).scalar_one_or_none()
    query = (
        update(User)
        .where(User.uuid == user_uuid)
        .values(permissions_uuid=user.permissions_uuid)
    )
    response = await db.execute(query)
    await db.commit()
    if response.rowcount == 0:  # type: ignore
        raise HTTPException(404, detail="User not found")
    # A user's type sets their limits (a developer has none)
    app_helpers.invalidate_usage_cache(user_uuid)

    # Handle shared dashboards
    if old_entity_uuid != new_entity_uuid:
        await crud.remove_shares_both_ways(db, user_uuid)
        await crud.update_user_dashboards_new_entity(db, user_uuid, new_entity_uuid)
        await app_helpers.left_organization(db, user_uuid)

    # Destroy all other app sessions for the user
    await auth_helpers.delete_user_app_sessions(
        db, user_uuid, ["app", "oauth-app", "excel"]
    )
    return {"success": True}


@router.get("/user", response_model=CustomPage[schemas.EntityUserReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_users(
    request: Request,
    email: str = "",
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    query = select(User.uuid, User.email, User.permissions_uuid)
    if email:
        query = query.where(User.email.contains(email))

    async def transformer(items: list[User]):
        cleaned = []
        for item in items:
            permissions_query = (
                select(PermissionsEntityMap)
                .where(PermissionsEntityMap.uuid == item.permissions_uuid)
                .limit(1)
            )
            permissions = (await db.execute(permissions_query)).scalar_one_or_none()
            cleaned.append(
                schemas.EntityUserReturn(
                    uuid=item.uuid,
                    email=item.email,
                    permissions=permissions,
                )
            )
        return cleaned

    return await paginate(db, query, transformer=transformer)


@router.delete("/entity/{entity_uuid}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def delete_entity(
    entity_uuid: UUID,
    request: Request,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    """Delete an entity by uuid if it has no users"""
    users_in_entity = await app_helpers.get_entity_users(db, entity_uuid)
    if users_in_entity:
        raise HTTPException(
            status_code=400, detail="Cannot delete entity with existing users"
        )
    delete_query = delete(models.Entity).where(models.Entity.uuid == entity_uuid)
    result = await db.execute(delete_query)
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Entity not found")
    await db.commit()
    return schemas.SuccessReturn.success_instance()


@router.post("/role", response_model=schemas.SuccessReturn)
async def post_role(
    role: schemas.PostRole,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    """
    Create a new role for the entity
    """
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    insert_query = insert(models.Role).values(
        **role.model_dump(exclude={"users"}), entity_uuid=entity_uuid
    )
    role_uuid = (await db.execute(insert_query)).inserted_primary_key[0]

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
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    """
    Get all roles for the entity
    """
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    query = select(models.Role).where(models.Role.entity_uuid == entity_uuid)
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
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    """Get a role by uuid"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    role = (
        await db.execute(
            select(models.Role).where(
                models.Role.uuid == role_uuid,
                models.Role.entity_uuid == entity_uuid,
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
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    """Patch a role"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")
    affected_users = set(await app_helpers.get_role_user_uuids(db, role_uuid))

    # Update the role details and settings that were sent
    adjusted_role = role.changes()

    if adjusted_role:
        query = (
            update(models.Role)
            .where(
                models.Role.uuid == role_uuid, models.Role.entity_uuid == entity_uuid
            )
            .values(**adjusted_role)
        )
        await db.execute(query)
        await db.commit()

    # Update users if provided
    if role.users is not None:  # Check if None since empty list is valid
        await app_helpers.update_role_users(db, role_uuid, role.users)

    affected_users.update(await app_helpers.get_role_user_uuids(db, role_uuid))
    await app_helpers.roles_changed(db, list(affected_users))
    return schemas.SuccessReturn.success_instance()


@router.delete("/role/{role_uuid}", response_model=schemas.SuccessReturn)
async def delete_role(
    role_uuid: UUID,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    """Delete a role"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")
    role_users = await app_helpers.get_role_user_uuids(db, role_uuid)

    # Delete the group - UserGroup entries will be cascade deleted due to foreign key constraint
    result = await db.execute(delete(models.Role).where(models.Role.uuid == role_uuid))

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Role not found")

    await db.commit()
    await app_helpers.roles_changed(db, role_users)
    return schemas.SuccessReturn.success_instance()


@router.put("/role-permissions/{role_uuid}", response_model=schemas.SuccessReturn)
async def put_role_permissions(
    role_uuid: UUID,
    role_permissions: list[schemas.RolePermissions],
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    """Update the permissions for a role"""
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")

    for role_permission in role_permissions:
        if role_permission.type == "backend":
            await app_helpers.insert_or_update_backend_permissions(
                db, role_uuid, role_permission.uuid, role_permission
            )
        elif role_permission.type == "file":
            await app_helpers.insert_or_update_file_permissions(
                db, role_uuid, role_permission.uuid, role_permission.access
            )

    await db.commit()

    return schemas.SuccessReturn.success_instance()


@router.get(
    "/role-permissions/{role_uuid}", response_model=list[schemas.RolePermissions]
)
async def get_role_permissions(
    role_uuid: UUID,
    db: AsyncSession = Depends(aget_read_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
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
    return permissions


@router.post("/data-backends/{entity_uuid}")
async def add_data_backend(
    entity_uuid: UUID,
    data_backend: schemas.CreateApiSource,
    db: AsyncSession = Depends(aget_write_db),
    _: User = Depends(auth_helpers.get_current_superuser),
):
    """Add a data backend to the entity"""

    insert_query = insert(models.ApiSource).values(
        **data_backend.model_dump(), entity_uuid=entity_uuid
    )

    await db.execute(insert_query)
    await db.commit()
    return schemas.SuccessReturn.success_instance()


@router.delete("/data-backends/{entity_uuid}/{backend_name}")
async def delete_data_backend(
    entity_uuid: UUID,
    backend_name: str,
    db: AsyncSession = Depends(aget_write_db),
    _: User = Depends(auth_helpers.get_current_superuser),
):
    """Delete a data backend from the entity"""
    delete_query = delete(models.ApiSource).where(
        models.ApiSource.entity_uuid == entity_uuid,
        models.ApiSource.name == backend_name,
    )
    result = await db.execute(delete_query)
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Data backend not found")

    await db.commit()
    return schemas.SuccessReturn.success_instance()


@router.get(
    "/data-backends/{entity_uuid}", response_model=list[schemas.ReturnApiSource]
)
async def get_data_backends(
    entity_uuid: UUID,
    db: AsyncSession = Depends(aget_read_db),
    _: User = Depends(auth_helpers.get_current_superuser),
):
    """Get the data backends for the entity"""
    query = select(models.ApiSource).where(models.ApiSource.entity_uuid == entity_uuid)
    data_backends = await db.execute(query)

    return data_backends.scalars().all()
