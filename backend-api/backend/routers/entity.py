from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path, Query, Request
from fastapi_pagination import Page
from fastapi_pagination.customization import CustomizedPage, UseParamsFields
from fastapi_pagination.ext.sqlalchemy import paginate
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, models, schemas
from api.database import aget_read_db, aget_write_db
from api.models import (
    Entity,
    PermissionsEntityMap,
    User,
)
from api.rate_limit import LIMIT_DEFAULT, exempt_service_token, limiter
from routers import administration, app_helpers, routers_helpers

router = APIRouter(prefix="/entity", tags=["entity"])

CustomPage = CustomizedPage[
    Page, UseParamsFields(size=Query(100, ge=1, le=1000, description="How many items a page holds"))
]


@router.get(
    "/validate",
    response_model=schemas.SuccessReturn,
    summary="Check that the caller is a superuser",
    description="Answers success when the signed-in user is a superuser, and the status 403 when the user is not.",
)
async def validate_entity_admin(
    _=Depends(auth_helpers.get_current_superuser),
):
    return schemas.SuccessReturn.success_instance()


@router.post(
    "/entity",
    response_model=schemas.AddEntityReturn,
    summary="Create an organization",
    description=(
        "Creates an organization with the given name and sharing setting, together with its three permission maps, "
        "Admin, Developer and User, and its default roles, and returns the UUIDs of the organization and of its Admin "
        "map. The API notifies its administrators in the background that the organization was created. Answers 409 when "
        "an organization with that name exists. POST /entity/register-admin invites the organization's first admin."
    ),
)
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


@router.put(
    "/entity/{entity_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Change an organization's name and sharing",
    description=(
        "Changes the name and the sharing setting of an organization. When sharing is switched off, the shares that the "
        "change no longer allows are revoked. Answers 404 when the organization does not exist and 409 when another "
        "organization has the name."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_entity(
    entity_uuid: Annotated[UUID, Path(description="The UUID of the organization.")],
    request: Request,
    entity: schemas.EntityBase,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    await administration.update_entity(db, entity_uuid, entity)
    return {"success": True}


@router.get(
    "/entity",
    response_model=CustomPage[schemas.EntityReturn],
    summary="List the organizations",
    description=(
        "Returns a page of the organizations, ordered by name. The query parameters `page` and `size` select the page."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_entities(
    request: Request,
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    def transformer(items: list[Entity]):
        return [administration.entity_return(item) for item in items]

    return await paginate(db, administration.entities_query(), transformer=transformer)


async def check_entity_map_free(
    db: AsyncSession, entity_map: schemas.EntityMapCreate, map_uuid: UUID | None = None
) -> None:
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


@router.post(
    "/entity-map",
    response_model=schemas.UUIDReturn,
    summary="Add a permission map to an organization",
    description=(
        "Adds a permission map of the given type, Admin, Developer or User, to an organization and returns its UUID. "
        "Answers 409 when the organization already has a map of that type and 404 when the map cannot be created."
    ),
)
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


@router.put(
    "/entity-map/{map_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Change a permission map",
    description=(
        "Changes the organization and the type of a permission map. Answers 409 when the organization already has a map "
        "of that type, 404 when the map does not exist, and 400 when the data is rejected."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_entity_map(
    map_uuid: Annotated[UUID, Path(description="The UUID of the permission map.")],
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


@router.get(
    "/entity-map",
    response_model=CustomPage[schemas.EntityMapReturn],
    summary="List the permission maps of all organizations",
    description=(
        "Returns a page of the permission maps of every organization, each with its organization. The query parameters "
        "`page` and `size` select the page."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_entity_maps(
    request: Request,
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    query = select(PermissionsEntityMap)
    return await paginate(db, query)


@router.post(
    "/register-admin",
    response_model=schemas.SuccessReturn,
    summary="Invite a user into any organization",
    description=(
        "Records an invitation for the email address, so that the person can register with the user type of the given "
        "permissions map, which may belong to any organization. Use the Admin map of an organization to invite its "
        "admin. Answers 409 when a user with that email exists or the address is already invited, and 403 when "
        "registration is disabled."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def register_admin(
    request: Request,
    user: schemas.UserCreateAdmin,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    extra_info = schemas.RegisterAppUser(inviting_uuid=admin.uuid)
    result = await routers_helpers.register_app_user(db, user, extra_info)
    return schemas.SuccessReturn.from_bool(result)


@router.put(
    "/user/{user_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Move a user to a permissions map",
    description=(
        "Gives the user the permissions map, which may belong to another organization, and ends the user's web app "
        "sessions. When the organization changes, the shares between the user and the old organization's users are "
        "removed and the user receives the default roles of the new organization. Answers 404 when the map or the user "
        "does not exist."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_user(
    user_uuid: Annotated[UUID, Path(description="The UUID of the user.")],
    request: Request,
    user: schemas.UserUpdateAdmin,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    await administration.move_user(db, user_uuid, user.permissions_uuid)
    return {"success": True}


@router.get(
    "/user",
    response_model=CustomPage[schemas.EntityUserReturn],
    summary="List the users",
    description=(
        "Returns a page of the users who are not deleted, ordered by email, each with their permissions map. The query "
        "parameter `email` keeps only the users whose email contains it, and `page` and `size` select the page."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_users(
    request: Request,
    email: Annotated[str, Query(description="Keep only the users whose email contains this text.")] = "",
    db: AsyncSession = Depends(aget_read_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    async def transformer(items: list[User]):
        return [await administration.user_return(db, item) for item in items]

    return await paginate(db, administration.users_query(email), transformer=transformer)


@router.delete(
    "/entity/{entity_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Delete an organization",
    description=(
        "Deletes an organization that has no users. Answers 400 when the organization still has users and 404 when it "
        "does not exist."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def delete_entity(
    entity_uuid: Annotated[UUID, Path(description="The UUID of the organization.")],
    request: Request,
    db: AsyncSession = Depends(aget_write_db),
    _=Depends(auth_helpers.get_current_superuser),
):
    await administration.delete_entity(db, entity_uuid)
    return schemas.SuccessReturn.success_instance()


@router.post(
    "/role",
    response_model=schemas.SuccessReturn,
    summary="Create a role in the superuser's organization",
    description=(
        "Creates a role in the organization of the signed-in superuser and adds the listed users, who must belong to "
        "that organization."
    ),
)
async def post_role(
    role: schemas.PostRole,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
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


@router.get(
    "/role",
    response_model=list[schemas.GetRoleWithUsers],
    summary="List the roles of the superuser's organization",
    description="Returns the roles of the organization of the signed-in superuser, each with the emails of its users.",
)
async def get_roles(
    db: AsyncSession = Depends(aget_read_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    query = select(models.Role).where(models.Role.entity_uuid == entity_uuid)
    roles = await db.execute(query)

    result = []
    for role in roles.scalars():
        role_users = await app_helpers.get_role_users(db, role.uuid)
        result.append(schemas.GetRoleWithUsers.from_role(role, role_users))
    return result


@router.get(
    "/role/{role_uuid}",
    response_model=schemas.GetRoleWithUsers,
    summary="Get a role of the superuser's organization",
    description=(
        "Returns one role of the organization of the signed-in superuser with the emails of its users. Answers 404 when "
        "the role does not exist in that organization."
    ),
)
async def get_role(
    role_uuid: Annotated[UUID, Path(description="The UUID of the role.")],
    db: AsyncSession = Depends(aget_read_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
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


@router.patch(
    "/role/{role_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Change a role of the superuser's organization",
    description=(
        "Changes the fields of the role that the request names. When `users` is present, the listed users become the "
        "members of the role: the missing ones are added and the others are removed. Answers 404 when the role does not "
        "exist in the superuser's organization."
    ),
)
async def patch_role(
    role_uuid: Annotated[UUID, Path(description="The UUID of the role.")],
    role: schemas.PatchRole,
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")
    affected_users = set(await app_helpers.get_role_user_uuids(db, role_uuid))

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

    if role.users is not None:
        await app_helpers.update_role_users(db, role_uuid, role.users)

    affected_users.update(await app_helpers.get_role_user_uuids(db, role_uuid))
    await app_helpers.roles_changed(db, list(affected_users))
    return schemas.SuccessReturn.success_instance()


@router.delete(
    "/role/{role_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Delete a role of the superuser's organization",
    description=(
        "Deletes the role, so that its users lose the access that only the role gave them. Answers 404 when the role "
        "does not exist in the superuser's organization."
    ),
)
async def delete_role(
    role_uuid: Annotated[UUID, Path(description="The UUID of the role.")],
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")
    role_users = await app_helpers.get_role_user_uuids(db, role_uuid)

    result = await db.execute(delete(models.Role).where(models.Role.uuid == role_uuid))

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Role not found")

    await db.commit()
    await app_helpers.roles_changed(db, role_users)
    return schemas.SuccessReturn.success_instance()


@router.put(
    "/role-permissions/{role_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Set the access of a role to backends and files",
    description=(
        "Sets the access level that the role grants to each backend and file in the request, and leaves the items that "
        "the request does not name as they are. Items of any other type are ignored. Answers 404 when the role does not "
        "exist in the superuser's organization."
    ),
)
async def put_role_permissions(
    role_uuid: Annotated[UUID, Path(description="The UUID of the role.")],
    role_permissions: list[schemas.RolePermissions],
    db: AsyncSession = Depends(aget_write_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
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
    "/role-permissions/{role_uuid}",
    response_model=list[schemas.RolePermissions],
    summary="List the backends and files that a role grants",
    description=(
        "Returns the backends and files that the role grants access to, each with its access level. Answers 404 when "
        "the role does not exist in the superuser's organization."
    ),
)
async def get_role_permissions(
    role_uuid: Annotated[UUID, Path(description="The UUID of the role.")],
    db: AsyncSession = Depends(aget_read_db),
    admin: User = Depends(auth_helpers.get_current_superuser),
):
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if not await app_helpers.role_exists(db, role_uuid, entity_uuid):
        raise HTTPException(status_code=404, detail="Role not found")

    permissions = []
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


@router.post(
    "/data-backends/{entity_uuid}",
    summary="Add a data backend to an organization",
    description=(
        "Adds a data backend with the name and URL in the request to the organization. Users see it only when one of "
        "their roles grants access to it."
    ),
)
async def add_data_backend(
    entity_uuid: Annotated[UUID, Path(description="The UUID of the organization.")],
    data_backend: schemas.CreateApiSource,
    db: AsyncSession = Depends(aget_write_db),
    _: User = Depends(auth_helpers.get_current_superuser),
):
    await administration.add_data_backend(db, entity_uuid, data_backend)
    return schemas.SuccessReturn.success_instance()


@router.delete(
    "/data-backends/{entity_uuid}/{backend_name}",
    summary="Delete a data backend of an organization",
    description=(
        "Deletes the organization's data backend with the given name. Answers 404 when the organization has no backend "
        "with that name."
    ),
)
async def delete_data_backend(
    entity_uuid: Annotated[UUID, Path(description="The UUID of the organization.")],
    backend_name: Annotated[str, Path(description="The name of the data backend.")],
    db: AsyncSession = Depends(aget_write_db),
    _: User = Depends(auth_helpers.get_current_superuser),
):
    await administration.delete_data_backend(db, entity_uuid, backend_name)
    return schemas.SuccessReturn.success_instance()


@router.get(
    "/data-backends/{entity_uuid}",
    response_model=list[schemas.ReturnApiSource],
    summary="List the data backends of an organization",
    description="Returns the data backends that belong to the organization.",
)
async def get_data_backends(
    entity_uuid: Annotated[UUID, Path(description="The UUID of the organization.")],
    db: AsyncSession = Depends(aget_read_db),
    _: User = Depends(auth_helpers.get_current_superuser),
):
    return await administration.data_backends(db, entity_uuid)
