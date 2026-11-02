import asyncio
from time import time
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from loguru import logger
from sqlalchemy import not_, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, crud, models, schemas
from api.database import aget_read_db, aget_write_db
from api.models import (
    DashboardItem,
    DashboardSave,
    DashboardShare,
    PermissionsEntityMap,
    User,
)
from api.rate_limit import LIMIT_DEFAULT, exempt_service_token, limiter
from routers import app_helpers

router = APIRouter(
    prefix="/app/dash",
    tags=["app-dash"],
)


async def validate_dashboard_ownership(
    db: AsyncSession, dashboard_uuid: UUID, user_uuid: UUID
):
    error_message = await crud.dashboard_owner_errors(db, dashboard_uuid, user_uuid)
    if error_message:
        raise HTTPException(status_code=403, detail=error_message)


@router.get(
    "/sync/owned",
    response_model=schemas.DashboardOwned,
    summary="List the dashboards that the user owns",
    description="Returns the dashboards that the signed-in user owns, by UUID.",
)
async def get_owned_items(
    db: AsyncSession = Depends(aget_read_db),
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)
    ),
):
    owned = await crud.get_user_dashboards_owned(db, user.uuid)
    return schemas.DashboardOwned(owned=owned)


@router.get(
    "/sync/shared",
    response_model=schemas.DashboardShared,
    summary="List the dashboards shared with the user",
    description=(
        "Returns the dashboards that other users shared with the signed-in user, and, separately, the dashboards that "
        "the user's organization shares with all of its users. A dashboard that is in both lists appears only in "
        "`shared`."
    ),
)
async def get_shared_items(
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)
    ),
):
    tasks: list[asyncio.Task[crud.UserDashboards]] = [
        asyncio.create_task(app_helpers.dashboard_task("shared", user.uuid)),
        asyncio.create_task(
            app_helpers.dashboard_task("entity_shared", user.uuid, user.permissions_uuid)
        ),
    ]
    shared, entity_shared = await asyncio.gather(*tasks)
    entity_shared = {k: v for k, v in entity_shared.items() if k not in shared}
    return schemas.DashboardShared(shared=shared, entity_shared=entity_shared)


@router.get(
    "/sync",
    response_model=schemas.DashboardComplete,
    summary="List all of the user's dashboards",
    description=(
        "Returns the dashboards that the user owns, the dashboards shared with the user, and the dashboards that the "
        "user's organization shares, each by UUID."
    ),
)
async def get_items(
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)
    ),
):
    return await app_helpers.get_dashboards_complete(user=user)


@router.get(
    "/validate-and-sync",
    response_model=schemas.DashboardCompleteWithContext,
    summary="Load everything the web app needs at start",
    description=(
        "Checks the session and returns, in one answer, the data that the web app needs when it starts: the user's "
        "dashboards and apps, Copilot chats and question history, MCP servers, skills, usage, access and Copilot "
        "access, display settings, file widgets, widget metadata and the organization's theme settings."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def dash_validate_and_get_items(  # noqa: PLR0914, PLR0915
    request: Request,
    db: AsyncSession = Depends(aget_write_db),
    user=Depends(
        auth_helpers.GetCurrentUser(
            [
                "uuid",
                "permissions_uuid",
                "display_settings",
                "is_superuser",
            ],
            ["FileWidget"],
            app_session=True,
        )
    ),
):
    start_time = time()
    dashboards_complete = await app_helpers.get_dashboards_complete(user=user)
    user_apps_complete = await app_helpers.get_user_apps_complete(user=user)

    chats = await app_helpers.get_copilot_chats(db, user.uuid)
    questions_history = await app_helpers.get_user_questions_history(db, user.uuid)

    mcp_servers = await app_helpers.get_mcp_servers(db, user)

    user_skills = await app_helpers.get_user_skill_state(db, user.uuid)

    usage = await schemas.UsageGet.check_cache(db, user)

    copilot_access = await app_helpers.get_user_copilot_access(db, user.uuid)

    access = await app_helpers.get_user_access(db, user.uuid)
    own_connections = access.user_type in models.CONNECTION_TYPES

    entity_uuid = await app_helpers.get_entity_uuid(db, user.uuid)
    entity_theme_settings = await app_helpers.get_entity_theme_settings(db, entity_uuid)
    widget_metadata = await app_helpers.get_widget_metadata(db=db, user=user)

    process_time = (time() - start_time) * 1000
    logger.warning(f"Dashboard task took {process_time:.2f} ms", exclude=True)
    return schemas.DashboardCompleteWithContext(
        shared=dashboards_complete.shared,
        entity_shared=dashboards_complete.entity_shared,
        owned=dashboards_complete.owned,
        usage=usage,
        access=access,
        copilot_chats=chats,
        questions_history=questions_history,
        mcp_servers=mcp_servers.get_servers_json(),
        display_settings=user.display_settings,
        file_widgets=[x.__dict__ for x in user.FileWidget] if own_connections else [],
        user_apps=user_apps_complete,
        entity_theme_settings=entity_theme_settings.model_dump(),
        widget_metadata=widget_metadata,
        user_skills=user_skills,
        copilot_access=copilot_access,
    )


@router.post(
    "/sync",
    response_model=schemas.SuccessReturn,
    summary="Save the user's dashboards",
    description=(
        "Creates, updates and deletes dashboards in one request. Each key of `items` is a dashboard UUID, and its value "
        "is the dashboard's content, or the string `DELETE` to delete the dashboard. The API strips credentials from "
        "the endpoints in the content. Answers 400 when the database rejects the change."
    ),
)
async def update_items(
    dashboard: schemas.DashboardsCreate,
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)
    ),
):
    try:
        await crud.bulk_dashboard_insert_update(
            db, dashboard, user.uuid, user.permissions_uuid
        )
    except SQLAlchemyError as e:
        logger.error(e)
        await db.rollback()
        raise HTTPException(
            status_code=400, detail="Could not successfully update the items"
        ) from e
    return {"success": True}


@router.get(
    "/{dashboard_uuid}/versions",
    response_model=list[schemas.DashboardSave],
    summary="List the saved versions of a dashboard",
    description=(
        "Returns the saved versions of the dashboard, newest first, each with its content. The owner can read them, and "
        "so can a user with whom the dashboard is shared and, when the dashboard is shared with the organization, any "
        "user of the organization whose roles allow sharing. Answers 403 to any other user and 400 when the user's "
        "organization cannot be found."
    ),
)
async def dashboard_versions(
    dashboard_uuid: Annotated[UUID, Path(description="The UUID of the dashboard.")],
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)
    ),
):
    async def get_versions():
        query = (
            select(
                DashboardSave.content, DashboardSave.uuid, DashboardSave.created_date
            )
            .where(DashboardSave.dashboard_item_uuid == dashboard_uuid)
            .order_by(DashboardSave.created_date.desc())
        )
        return (await db.execute(query)).mappings().all()

    if not await crud.dashboard_owner_errors(db, dashboard_uuid, user.uuid):
        return await get_versions()
    shared_query = (
        select(DashboardShare.uuid)
        .where(DashboardShare.dashboard_item_uuid == dashboard_uuid)
        .where(
            DashboardShare.shared_user_uuid == user.uuid,
            DashboardShare.active.is_(True),
        )
    ).limit(1)
    if (await db.execute(shared_query)).first():
        return await get_versions()
    if (await crud.get_users_sharing(db, [user.uuid]))[user.uuid] == models.SHARING_NONE:
        raise HTTPException(
            status_code=403, detail="You do not have permission to view this dashboard"
        )
    user_entity_query = (
        select(PermissionsEntityMap.entity_uuid)
        .where(PermissionsEntityMap.uuid == user.permissions_uuid)
        .limit(1)
    )
    user_entity = (await db.execute(user_entity_query)).scalar_one_or_none()
    if user_entity is None:
        raise HTTPException(status_code=400, detail="Unable to find the user's entity")

    query = (
        select(
            DashboardItem.uuid,
        )
        .join(User, User.uuid == DashboardItem.owner_uuid)
        .join(PermissionsEntityMap, User.permissions_uuid == PermissionsEntityMap.uuid)
        .where(
            DashboardItem.uuid == dashboard_uuid,
            DashboardItem.entity_share.is_(True),
            PermissionsEntityMap.entity_uuid == user_entity,
        )
    ).limit(1)

    if (await db.execute(query)).first():
        return await get_versions()

    raise HTTPException(
        status_code=403, detail="You do not have permission to view this dashboard"
    )


@router.post(
    "/{dashboard_uuid}/toggle-entity-sharing",
    response_model=schemas.ShareReturn,
    summary="Share a dashboard with the organization, or stop",
    description=(
        "Switches sharing with the whole organization on when it is off, and off when it is on. When the user is a "
        "Developer, switching it on does not take effect at once: the route files a request that an admin must approve "
        "and answers with `pending_approval` set to true. Answers 403 when the user does not own the dashboard or the "
        "user's roles do not allow sharing."
    ),
)
async def toggle_entity_sharing(
    dashboard_uuid: Annotated[UUID, Path(description="The UUID of the dashboard.")],
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)
    ),
):
    await validate_dashboard_ownership(db, dashboard_uuid, user.uuid)
    entity_share_query = select(DashboardItem.entity_share).where(
        DashboardItem.uuid == dashboard_uuid
    )
    if not (await db.execute(entity_share_query)).scalar_one_or_none():
        await crud.check_may_share(db, user.uuid)
        if await app_helpers.shares_need_approval(db, user.uuid):
            await crud.request_entity_share(db, user.uuid, dashboard_uuid)
            return schemas.ShareReturn(success=True, pending_approval=True)
    toggle_query = (
        update(DashboardItem)
        .where(DashboardItem.uuid == dashboard_uuid)
        .values(entity_share=not_(DashboardItem.entity_share))
    )
    await db.execute(toggle_query)
    await db.commit()
    return {"success": True}


@router.get(
    "/{dashboard_uuid}/shares",
    response_model=dict[str, schemas.DashboardShareReturn],
    summary="List the shares of a dashboard",
    description=(
        "Returns the users with whom the signed-in owner shares the dashboard, by email, each with the permissions that "
        "the share gives. A share that waits for an admin's approval is included with `pending` set to true."
    ),
)
async def get_shares(
    dashboard_uuid: Annotated[UUID, Path(description="The UUID of the dashboard.")],
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "email", "permissions_uuid"], app_session=True)
    ),
):
    final_result: dict[str, schemas.DashboardShareReturn] = {}
    query = (
        select(
            User.email,
            User.first_name,
            User.last_name,
            DashboardShare.permissions,
            DashboardShare.created_date,
        )
        .select_from(DashboardShare)
        .join(User, User.uuid == DashboardShare.shared_user_uuid)
        .join(DashboardItem, DashboardItem.uuid == DashboardShare.dashboard_item_uuid)
        .where(
            DashboardShare.active.is_(True),
            DashboardItem.owner_uuid == user.uuid,
            DashboardItem.uuid == dashboard_uuid,
        )
    )
    for shared in (await db.execute(query)).mappings().all():
        final_result[shared.email] = schemas.DashboardShareReturn(
            first_name=shared.first_name,
            last_name=shared.last_name,
            permissions=shared.permissions,
            created_date=shared.created_date,
        )
    for waiting in await crud.get_waiting_shares(
        db, user.uuid, dashboard_uuid=dashboard_uuid
    ):
        final_result[waiting.email] = schemas.DashboardShareReturn(
            first_name=waiting.first_name,
            last_name=waiting.last_name,
            permissions=waiting.permissions,
            created_date=waiting.created_date,
            pending=True,
        )
    return final_result


@router.post(
    "/{dashboard_uuid}/share",
    response_model=schemas.ShareReturn,
    summary="Share a dashboard with users",
    description=(
        "Shares the dashboard with the users in the request, who must belong to the owner's organization and be allowed "
        "to receive shares, with the permissions that the request names. A user who already has a share is skipped. "
        "When the owner is a Developer, the shares become requests that an admin must approve, and the answer has "
        "`pending_approval` set to true. Answers 400 when the owner has no permissions map, 403 when the user does not "
        "own the dashboard or may not share, and 402 when none of the recipients is in the owner's organization."
    ),
)
async def add_share(
    dashboard_uuid: Annotated[UUID, Path(description="The UUID of the dashboard.")],
    share: schemas.ShareDashboard,
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "email", "permissions_uuid"], app_session=True)
    ),
):
    if user.permissions_uuid is None:
        raise HTTPException(
            status_code=400, detail="The user does not have permissions"
        )
    await validate_dashboard_ownership(db, dashboard_uuid, user.uuid)
    await crud.check_may_share(db, user.uuid)
    clean_shares = await crud.get_shares_without_existing(
        db, share, dashboard_uuid, user.email
    )
    if not clean_shares:
        return schemas.ShareReturn.success_instance()

    user_permissions, user_uuids = (
        await crud.get_new_sharing_permissions(
            db, clean_shares, user.permissions_uuid, dashboard_uuid
        )
    )
    await crud.check_share_recipients(db, user_uuids)

    if not user_permissions:
        raise HTTPException(
            status_code=402, detail="User not found in your organization"
        )
    if await app_helpers.shares_need_approval(db, user.uuid):
        await crud.request_shares(
            db, user.uuid, user_permissions, dashboard_uuid=dashboard_uuid
        )
        return schemas.ShareReturn(success=True, pending_approval=True)

    await crud.apply_shares(db, user.uuid, user_permissions, dashboard_uuid=dashboard_uuid)
    return schemas.ShareReturn.success_instance()


@router.patch(
    "/{dashboard_uuid}/share",
    response_model=schemas.ShareReturn,
    summary="Change the permissions of a dashboard share",
    description=(
        "Changes the permissions that the listed recipients have on the dashboard. When the owner is a Developer, the "
        "changes become requests that an admin must approve, and the answer has `pending_approval` set to true. Answers "
        "403 when the user does not own the dashboard or may not share."
    ),
)
async def update_share(
    dashboard_uuid: Annotated[UUID, Path(description="The UUID of the dashboard.")],
    share: schemas.ShareDashboard,
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid", "email"], app_session=True)),
):
    await validate_dashboard_ownership(db, dashboard_uuid, user.uuid)
    await crud.check_may_share(db, user.uuid)
    current_shares_query = (
        select(
            User.email,
            DashboardShare.permissions,
            DashboardShare.uuid,
            DashboardShare.shared_user_uuid,
        )
        .join(DashboardShare, User.uuid == DashboardShare.shared_user_uuid)
        .where(
            DashboardShare.dashboard_item_uuid == dashboard_uuid,
            DashboardShare.active.is_(True),
            User.email.in_(share.shares.keys()),
        )
    )
    current_shares_response = (await db.execute(current_shares_query)).mappings().all()
    if not current_shares_response:
        await crud.handle_dashboard_is_shared(db, dashboard_uuid)
        return schemas.ShareReturn.success_instance()
    await crud.check_share_recipients(
        db, [x.shared_user_uuid for x in current_shares_response]
    )
    current_shares = {x.email: (x.permissions, x.uuid) for x in current_shares_response}
    updates = []
    for key, value in current_shares.items():
        if value[0] != share.shares[key]:
            data = {"uuid": value[1], "permissions": share.shares[key]}
            updates.append(data)
    if updates and await app_helpers.shares_need_approval(db, user.uuid):
        recipients = {x.uuid: x.shared_user_uuid for x in current_shares_response}
        await crud.request_shares(
            db,
            user.uuid,
            [
                {
                    "dashboard_item_uuid": dashboard_uuid,
                    "shared_user_uuid": recipients[change["uuid"]],
                    "permissions": change["permissions"],
                }
                for change in updates
            ],
            dashboard_uuid=dashboard_uuid,
        )
        return schemas.ShareReturn(success=True, pending_approval=True)
    if updates:
        await db.execute(update(DashboardShare), updates)
        await db.commit()

    await crud.handle_dashboard_is_shared(db, dashboard_uuid)
    return schemas.ShareReturn.success_instance()


@router.delete(
    "/{dashboard_uuid}/share",
    response_model=schemas.SuccessReturn,
    summary="Stop sharing a dashboard with users",
    description=(
        "Ends the shares of the dashboard with the listed emails, and cancels their pending share requests. The owner "
        "can end any share of the dashboard, and a recipient can end their own."
    ),
)
async def delete_share(
    dashboard_uuid: Annotated[UUID, Path(description="The UUID of the dashboard.")],
    share: schemas.ShareDashboardList,
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid", "email"], app_session=True)),
):
    current_shares_query = (
        select(DashboardShare.uuid, DashboardShare.shared_user_uuid)
        .join(User, User.uuid == DashboardShare.shared_user_uuid)
        .join(DashboardItem, DashboardShare.dashboard_item_uuid == DashboardItem.uuid)
        .where(
            DashboardShare.dashboard_item_uuid == dashboard_uuid,
            DashboardShare.active.is_(True),
            User.email.in_(share.shares),
            or_(
                DashboardItem.owner_uuid == user.uuid,
                DashboardShare.shared_user_uuid == user.uuid,
            ),
        )
    )
    current_shares_response = await db.execute(current_shares_query)
    results = current_shares_response.mappings().all()

    current_shares = [x["uuid"] for x in results]
    if current_shares:
        delete_query = (
            update(DashboardShare)
            .where(
                DashboardShare.uuid.in_(current_shares), DashboardShare.active.is_(True)
            )
            .values(active=False)
        )
        await db.execute(delete_query)
        await db.commit()

        user_uuids = [
            x["shared_user_uuid"] for x in results if x["shared_user_uuid"] != user.uuid
        ]

        await crud.unshare_files(
            db, user.uuid, user_uuids, dashboard_uuid=dashboard_uuid
        )

    await crud.cancel_share_requests(
        db, user.uuid, share.shares, dashboard_uuid=dashboard_uuid
    )
    await crud.handle_dashboard_is_shared(db, dashboard_uuid)

    return {"success": True}


@router.get(
    "/{dashboard_uuid}/shares/users",
    response_model=dict[str, schemas.DashboardShareReturn],
    summary="List the users that a dashboard can be shared with",
    description=(
        "Returns the other users of the owner's organization who can receive shares, by email. A user who already has a "
        "share carries the permissions and the date of the share, and the others carry none. Answers 403 when the user "
        "does not own the dashboard and 400 when the user's organization cannot be found."
    ),
)
async def see_available_users(
    dashboard_uuid: Annotated[UUID, Path(description="The UUID of the dashboard.")],
    db: AsyncSession = Depends(aget_write_db),
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "email", "permissions_uuid"], app_session=True)
    ),
):
    complete_list: dict[str, schemas.DashboardShareReturn] = {}
    await validate_dashboard_ownership(db, dashboard_uuid, user.uuid)
    user_entity_query = select(PermissionsEntityMap.entity_uuid).where(
        PermissionsEntityMap.uuid == user.permissions_uuid
    )
    user_entity = (await db.execute(user_entity_query)).scalar_one_or_none()
    if user_entity is None:
        raise HTTPException(status_code=400, detail="Unable to find the user's entity")
    all_users_query = (
        select(
            User.uuid,
            User.email,
            User.first_name,
            User.last_name,
            PermissionsEntityMap.entity_uuid,
        )
        .join(PermissionsEntityMap, User.permissions_uuid == PermissionsEntityMap.uuid)
        .where(
            PermissionsEntityMap.entity_uuid == user_entity,
            User.email != user.email,
        )
    )
    all_users = (await db.execute(all_users_query)).mappings().all()
    recipients = set(await crud.get_share_recipients(db, [x.uuid for x in all_users]))
    all_users = [x for x in all_users if x.uuid in recipients]

    shared_users_query = (
        select(
            User.email,
            User.first_name,
            User.last_name,
            DashboardShare.permissions,
            DashboardShare.created_date,
        )
        .join(DashboardShare, User.uuid == DashboardShare.shared_user_uuid)
        .where(
            DashboardShare.dashboard_item_uuid == dashboard_uuid,
            DashboardShare.active.is_(True),
        )
    )
    shared_users = (await db.execute(shared_users_query)).mappings().all()
    for share in shared_users:
        complete_list[share.email] = schemas.DashboardShareReturn(
            first_name=share.first_name,
            last_name=share.last_name,
            permissions=share.permissions,
            created_date=share.created_date,
        )
    for valid in all_users:
        if valid.email not in complete_list:
            complete_list[valid.email] = schemas.DashboardShareReturn(
                first_name=valid.first_name,
                last_name=valid.last_name,
                permissions=None,
                created_date=None,
            )
    return complete_list


@router.get(
    "/shared-dashboard-viewed",
    response_model=list[schemas.SharedDashboardViewed],
    summary="List which shared dashboards the user has opened",
    description=(
        "Returns, for each dashboard that is shared with the signed-in user, whether the user has viewed it. The query "
        "parameter `dashboard_uuid` limits the list to one dashboard. Answers 400 when no dashboard is shared with the "
        "user."
    ),
)
async def get_shared_dashboard_viewed(
    db: AsyncSession = Depends(aget_read_db),
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    dashboard_uuid: Annotated[
        UUID | None, Query(description="Return only whether the user has viewed this dashboard.")
    ] = None,
):
    shared_dashboard_query = select(
        DashboardShare.dashboard_item_uuid.label("dashboard_uuid"),
        DashboardShare.viewed,
    ).where(
        DashboardShare.shared_user_uuid == user.uuid,
    )
    if dashboard_uuid:
        shared_dashboard_query = shared_dashboard_query.where(
            DashboardShare.dashboard_item_uuid == dashboard_uuid,
        )
    shared_dashboards = (await db.execute(shared_dashboard_query)).all()
    if not shared_dashboards:
        raise HTTPException(
            status_code=400, detail="User does not have any shared dashboards."
        )

    return shared_dashboards


@router.patch(
    "/shared-dashboard-viewed/{dashboard_uuid}",
    response_model=schemas.SuccessReturn,
    summary="Mark a shared dashboard as viewed",
    description="Records that the signed-in user has viewed the dashboard that is shared with them.",
)
async def patch_shared_dashboard_viewed(
    dashboard_uuid: Annotated[UUID, Path(description="The UUID of the dashboard.")],
    db: AsyncSession = Depends(aget_read_db),
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
):
    update_query = (
        update(DashboardShare)
        .where(
            DashboardShare.shared_user_uuid == user.uuid,
            DashboardShare.dashboard_item_uuid == dashboard_uuid,
        )
        .values(viewed=True)
    )
    await db.execute(update_query)
    await db.commit()
    return schemas.SuccessReturn.success_instance()
