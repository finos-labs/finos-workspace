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
from api.rate_limit import LIMIT_DEFAULT, exempt_service_token, limiter
from routers import administration, app_helpers, routers_helpers

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
    await administration.create_entity_type(db, entity_type)
    return {"success": True}


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
    return await paginate(db, administration.entity_types_query())


@router.post("/entity", response_model=schemas.AddEntityReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def add_entity(
    request: Request,
    entity: schemas.EntityPost,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    answer = await administration.create_entity(db, entity)
    background_tasks.add_task(administration.notify_entity_created, entity)
    return answer


@router.put("/entity/{entity_uuid}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_entity(
    entity_uuid: UUID,
    request: Request,
    entity: schemas.EntityBase,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    await administration.update_entity(db, entity_uuid, entity)
    return {"success": True}


@router.get("/entity", response_model=CustomPage[schemas.EntityReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_entities(
    request: Request,
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    def transformer(items: list[Entity]):
        return [administration.entity_return(item) for item in items]

    return await paginate(db, administration.entities_query(), transformer=transformer)


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
    await administration.move_user(db, user_uuid, user.permissions_uuid)
    return {"success": True}


@router.get("/user", response_model=CustomPage[schemas.EntityUserReturn])
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_users(
    request: Request,
    email: str = "",
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    async def transformer(items: list[User]):
        return [await administration.user_return(db, item) for item in items]

    return await paginate(db, administration.users_query(email), transformer=transformer)


@router.delete("/entity/{entity_uuid}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def delete_entity(
    entity_uuid: UUID,
    request: Request,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    """Delete an entity by uuid if it has no users"""
    await administration.delete_entity(db, entity_uuid)
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
    await administration.add_data_backend(db, entity_uuid, data_backend)
    return schemas.SuccessReturn.success_instance()


@router.delete("/data-backends/{entity_uuid}/{backend_name}")
async def delete_data_backend(
    entity_uuid: UUID,
    backend_name: str,
    db: AsyncSession = Depends(aget_write_db),
    _: User = Depends(auth_helpers.get_current_superuser),
):
    """Delete a data backend from the entity"""
    await administration.delete_data_backend(db, entity_uuid, backend_name)
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
    return await administration.data_backends(db, entity_uuid)
