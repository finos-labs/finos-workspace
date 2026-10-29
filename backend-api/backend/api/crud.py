import json
import re
from datetime import (
    date as dateType,
    datetime,
)
from typing import Any, Literal, TypedDict, TypeVar
from uuid import UUID

from fastapi import HTTPException
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import Select, and_, case, delete, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, defer

from api import base, models, schemas
from api.models import (
    ApiSource,
    DashboardItem,
    DashboardSave,
    DashboardShare,
    Entity,
    Login,
    PermissionsEntityMap,
    ShareRequest,
    User,
    UserApp,
    UserAppShare,
)
from api.models.workspace_models import StoredFile, StoredFileShare
from api.storage import FileStorage
from utilities.config import settings

ItemT = TypeVar("ItemT")


async def acreate_helper(db: AsyncSession, item: ItemT) -> ItemT:
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def get_user_entity_uuid(db: AsyncSession, permissions_uuid: UUID) -> UUID:
    user_entity_query = (
        select(models.PermissionsEntityMap.entity_uuid)
        .where(models.PermissionsEntityMap.uuid == permissions_uuid)
        .limit(1)
    )

    return (await db.execute(user_entity_query)).scalar_one_or_none()


async def owned_dashboard_uuids(db: AsyncSession, owner_uuid: UUID) -> list[UUID]:
    result = await db.execute(select(DashboardItem.uuid).where(DashboardItem.owner_uuid == owner_uuid))
    return list(result.scalars().all())


async def bulk_dashboard_insert_update(  # noqa: PLR0912
    db: AsyncSession,
    dashboards: schemas.DashboardsCreate,
    owner_uuid: UUID,
    permissions_uuid: UUID,
):
    class Dashboard(BaseModel):
        uuid: UUID
        content: dict

    to_insert: list[Dashboard] = []
    to_update: list[Dashboard] = []
    to_delete: list[UUID] = []

    user_entity_uuid = await get_user_entity_uuid(db, permissions_uuid)
    dash_uuids = await owned_dashboard_uuids(db, owner_uuid)

    for key, value in dashboards.items.items():
        if key not in dash_uuids:
            if value == "DELETE":
                if await db.scalar(select(DashboardItem.uuid).where(DashboardItem.uuid == key)):
                    raise HTTPException(400, detail="User does not own dashboard")
                continue
            to_insert.append(Dashboard(uuid=key, content=value))
        elif key in dash_uuids:
            if value == "DELETE":
                to_delete.append(key)
            else:
                to_update.append(Dashboard(uuid=key, content=value))

    dashs_to_verify = to_delete + [x.uuid for x in to_update]
    for dashboard_uuid in dashs_to_verify:
        if dashboard_uuid not in dash_uuids:
            raise HTTPException(status_code=400, detail="User does not own dashboard")

    for item in to_insert:
        try:
            async with db.begin_nested():
                await db.execute(
                    insert(DashboardItem).values(
                        uuid=item.uuid,
                        owner_uuid=owner_uuid,
                        creator_uuid=owner_uuid,
                        content=item.content,
                        entity_uuid=user_entity_uuid,
                    )
                )
        except IntegrityError:
            owner = await db.scalar(
                select(DashboardItem.owner_uuid).where(DashboardItem.uuid == item.uuid)
            )
            if owner != owner_uuid:
                raise HTTPException(status_code=400, detail="User does not own dashboard") from None
            to_update.append(item)
    if to_update:
        cleaner_update = [{"uuid": x.uuid, "content": x.content} for x in to_update]
        await db.execute(update(DashboardItem), cleaner_update)

        from api.helpers import handle_share_files  # noqa

        await db.commit()
        for item in to_update:
            handle_share_files(owner_uuid, item.uuid)

    if to_delete:
        query = delete(DashboardItem).where(
            DashboardItem.uuid.in_(to_delete), DashboardItem.owner_uuid == owner_uuid
        )
        await db.execute(query)
    await db.commit()


EXTRACT_HREF_REGEX = r"(?:<a\s+(?:[^>]*?\s+)?href=(['\"])(.*?)\1.*?>)(.*?)(?:<\/a>)"
EXTRACT_TAGS_CONTEXT_REGEX = r"(?:<.*?>)(.*?)(?:<\/.*?>)"


def to_searchable_text(msg: dict[str, Any]) -> str | None:
    if not (text := msg.get("content")):
        return None

    if msg.get("role") == "human":
        return text

    text = re.sub(EXTRACT_HREF_REGEX, r"\2", text)
    text = re.sub(EXTRACT_TAGS_CONTEXT_REGEX, r"\1", text)

    return "".join([e.lower() for e in text if e.isalnum() or e.isspace()])


class InsertUpdateDelete(TypedDict):
    to_insert: list[dict]
    to_update: list[dict]
    to_delete: list[UUID]


def default_ops() -> InsertUpdateDelete:
    return {"to_insert": [], "to_update": [], "to_delete": []}


async def bulk_copilot_chats_insert_update(
    db: AsyncSession,
    owner_uuid: UUID,
    body: schemas.CopilotChatsCreate,
):
    message_updates = default_ops()
    chats_updates = default_ops()

    pending_chat_uuids = list(body.chats.keys())

    chat_query = select(models.CopilotChat.uuid).where(
        models.CopilotChat.user_uuid == owner_uuid,
        models.CopilotChat.uuid.in_(pending_chat_uuids),
    )
    messages_query = (
        select(
            models.ChatMessages.uuid,
            models.ChatMessages.chat_uuid,
        )
        .where(
            models.ChatMessages.user_uuid == owner_uuid,
            models.ChatMessages.chat_uuid.in_(pending_chat_uuids),
        )
        .order_by(models.ChatMessages.updated_date.desc())
    )

    chat_uuids = (await db.execute(chat_query)).scalars().all()
    chat_messages_uuids: dict[UUID, list[UUID]] = {}
    for m in (await db.execute(messages_query)).all():
        chat_messages_uuids.setdefault(m.chat_uuid, []).append(m.uuid)

    def process_messages(
        messages: dict[str | UUID, Literal["DELETE"] | dict], chat_uuid: UUID
    ):
        messages_uuids = chat_messages_uuids.get(chat_uuid, [])

        for key, msg in messages.items():
            uuid = UUID(key) if isinstance(key, str) else key
            if msg == "DELETE":
                if uuid in messages_uuids:
                    message_updates["to_delete"].append(uuid)
                continue

            data = {
                "uuid": uuid,
                "chat_uuid": chat_uuid,
                "user_uuid": owner_uuid,
                "content": msg,
                "role": msg.get("role"),
            }
            if msg.get("role") in {"ai", "human"} and not msg.get("isHidden"):
                data["searchable_content"] = to_searchable_text(msg)

            if uuid not in messages_uuids:
                created_date = base.time_ms_now(msg.get("timestamp"))
                data.update(
                    {"created_date": created_date, "updated_date": created_date}
                )
                message_updates["to_insert"].append(data)
            elif uuid in messages_uuids:
                message_updates["to_update"].append(data)

    for uuid, v in body.chats.items():
        if v == "DELETE":
            if uuid not in chat_uuids:
                raise HTTPException(400, detail="User does not own chat")
            chats_updates["to_delete"].append(uuid)
            continue

        entry, messages = v.to_entry(uuid, owner_uuid)

        if uuid not in chat_uuids:
            created_date = base.time_ms_now(entry.get("content", {}).get("createdAt"))
            entry.update({"created_date": created_date, "updated_date": created_date})
            chats_updates["to_insert"].append(entry)
        elif uuid in chat_uuids:
            chats_updates["to_update"].append(entry)

        process_messages(messages, uuid)

    chats_to_verify = chats_updates["to_delete"] + [
        x["uuid"] for x in chats_updates["to_update"]
    ]
    for chat_uuid in chats_to_verify:
        if chat_uuid not in chat_uuids:
            raise HTTPException(status_code=400, detail="User does not own chat")

    for array, query in [
        (chats_updates["to_insert"], insert(models.CopilotChat)),
        (chats_updates["to_update"], update(models.CopilotChat)),
        (message_updates["to_insert"], insert(models.ChatMessages)),
        (message_updates["to_update"], update(models.ChatMessages)),
    ]:
        if array:
            await db.execute(query, array)

    delete_ops: list[tuple[list[UUID], type[ItemT]]] = [
        (chats_updates["to_delete"], models.CopilotChat),
        (message_updates["to_delete"], models.ChatMessages),
    ]
    for uuids, model in delete_ops:
        query = delete(model).where(
            model.uuid.in_(uuids), model.user_uuid == owner_uuid
        )
        await db.execute(query)

    await db.commit()


SelectT = TypeVar("SelectT", bound=Select)


def prefix_match_last_word(search_term: str) -> str:
    body = search_term.removesuffix("\n")
    if body and (body[-1].isalnum() or body[-1] == "_"):
        return f"{body}:*{search_term[len(body) :]}"
    return search_term


def get_match_exprs(search_term: str) -> list:
    vector_match_exprs = []
    match_exprs = []

    if settings.DATABASE_TYPE == "postgresql":
        search_term = prefix_match_last_word(search_term)

    for w in search_term.split():
        word = w.strip()
        if len(word) < 3:  # ruff:ignore[magic-value-comparison]
            continue
        if settings.DATABASE_TYPE == "postgresql":
            vector_match_exprs.extend(
                [
                    models.ChatMessages.search_vector.match(word),
                    models.CopilotChat.search_vector.match(word),
                ]
            )

        word = re.sub(r"[^a-zA-Z0-9]", "", word)
        match_exprs.extend(
            [
                models.ChatMessages.searchable_content.contains(word),
                models.CopilotChat.label.contains(word),
            ]
        )
    return vector_match_exprs + match_exprs


def dialect_query(query: SelectT, search_term: str) -> SelectT:
    match_exprs = get_match_exprs(search_term)
    if settings.DATABASE_TYPE == "mysql":
        search_term = search_term.replace("'", "")
        msg_match = models.ChatMessages.searchable_content.match(
            search_term, with_query_expansion=True
        )
        label_match = models.CopilotChat.label.match(
            search_term, with_query_expansion=True
        )

        return query.where(or_(*[msg_match, label_match, *match_exprs])).order_by(
            msg_match.desc(),
            models.ChatMessages.searchable_content.contains(search_term).desc(),
            label_match.desc(),
        )

    if settings.DATABASE_TYPE == "postgresql":
        order_by_clause = func.ts_rank(
            models.ChatMessages.search_vector,
            func.plainto_tsquery("simple", search_term),
        )
        return query.where(
            models.ChatMessages.search_vector.is_not(None),
            models.CopilotChat.search_vector.is_not(None),
            or_(*match_exprs),
        ).order_by(order_by_clause.desc())

    if settings.DATABASE_TYPE == "sqlite":
        search_term = search_term.replace("'", "")

        return query.where(or_(*match_exprs)).order_by(
            models.ChatMessages.searchable_content.contains(search_term).desc(),
            models.CopilotChat.label.contains(search_term).desc(),
        )

    return query


async def search_copilot_chats(
    db: AsyncSession,
    user_uuid: UUID,
    search_term: str,
    start_date: dateType | datetime | None = None,
    end_date: dateType | datetime | None = None,
) -> list[schemas.Chat | schemas.ChatInfo]:
    query = (
        select(models.CopilotChat)
        .join(models.CopilotChat.messages)
        .where(
            models.CopilotChat.user_uuid == user_uuid,
            models.CopilotChat.label.is_not(None),
            models.ChatMessages.role.in_(["human", "ai"]),
            models.ChatMessages.searchable_content.is_not(None),
        )
        .options(
            contains_eager(models.CopilotChat.messages),
            defer(models.CopilotChat.artifacts),
        )
        .execution_options(populate_existing=True)
    )
    query = dialect_query(query, search_term.strip())

    if start_date:
        query = query.where(models.CopilotChat.created_date >= start_date)

    if end_date:
        query = query.where(models.CopilotChat.created_date <= end_date)

    results = await db.execute(query.limit(20))

    return [schemas.Chat.from_row(x, True) for x in results.unique().scalars().all()]


async def get_user(db: AsyncSession, identify: dict[str, Any]) -> None | User:
    query = select(User).filter_by(**identify)
    return (await db.execute(query)).scalars().first()


async def create_entity_relationship(
    db: AsyncSession, entity_relationship: schemas.EntityRelationshipCreate
) -> models.EntityRelationship:
    supreme_uuid = await models.entity_get_supreme(db, entity_relationship.parent_uuid)
    db_entity_relationship = models.EntityRelationship(
        parent_uuid=entity_relationship.parent_uuid,
        child_uuid=entity_relationship.child_uuid,
        supreme_uuid=supreme_uuid if supreme_uuid else entity_relationship.parent_uuid,
    )
    new = await acreate_helper(db, db_entity_relationship)
    return new


T = TypeVar("T", bound="schemas.DashboardReturn | schemas.UserAppReturn")


def get_value(
    result, user_uuid: UUID, Model: "type[T] | None" = schemas.DashboardReturn
) -> "T":
    kwargs = {}
    if isinstance(result.content, dict) and "shared_with" in result.content:
        kwargs["shared_with"] = result.content.pop("shared_with")

    return Model(
        content=result.content,
        creator=result.creator_uuid == user_uuid,
        created_date=result.created_date,
        updated_date=result.updated_date,
        is_shared=result.is_shared if hasattr(result, "is_shared") else False,
        created_by=(
            result.created_by.strip()
            if result.created_by and isinstance(result.created_by, str)
            else ""
        ),
        **kwargs,
    )


UserDashboards = dict[UUID, schemas.DashboardReturn]


async def get_user_dashboards_owned(
    db: AsyncSession, user_uuid: UUID
) -> UserDashboards:
    query = (
        select(
            DashboardItem.uuid,
            DashboardItem.content,
            DashboardItem.creator_uuid,
            DashboardItem.created_date,
            DashboardItem.updated_date,
            DashboardItem.is_shared,
            case(
                (
                    and_(User.first_name.is_not(None), User.last_name.is_not(None)),
                    func.concat(User.first_name, " ", User.last_name),
                ),
                else_=User.email,
            ).label("created_by"),
        )
        .join(User, User.uuid == DashboardItem.creator_uuid)
        .where(DashboardItem.owner_uuid == user_uuid)
    )
    results = await db.execute(query)
    return {x.uuid: get_value(x, user_uuid) for x in results.all()}


async def get_storedfile_uuids(
    db: AsyncSession,
    owner_uuid: UUID,
    dashboard_uuid: UUID | None = None,
    user_app_uuid: UUID | None = None,
) -> list[UUID]:
    if dashboard_uuid:
        return await get_dashboard_storedfile_uuids(db, dashboard_uuid, owner_uuid)
    elif user_app_uuid:
        return await get_user_app_storedfile_uuids(db, user_app_uuid, owner_uuid)
    return []


async def get_dashboard_storedfile_uuids(
    db: AsyncSession, dashboard_uuid: UUID | None, owner_uuid: UUID
) -> list[UUID]:
    if dashboard_uuid is None:
        return []

    dashboard_item = await get_dashboard_item(db, dashboard_uuid, owner_uuid)

    if not dashboard_item:
        return []

    item_dict: dict = (
        dashboard_item.content
        if isinstance(dashboard_item.content, dict)
        else json.loads(dashboard_item.content)
    )

    stored_file_uuids: list[str] = item_dict.get("data", {}).get("storedFileUUIDs", [])

    file_uuids = []
    for uuid in stored_file_uuids:
        try:
            file_uuid = UUID(uuid)
        except ValueError as e:
            logger.error(e)
            continue
        file_uuids.append(file_uuid)

    return file_uuids


async def get_user_app(
    db: AsyncSession, app_uuid: UUID, user_uuid: UUID
) -> None | models.UserApp:
    query = (
        select(UserApp)
        .where(UserApp.uuid == app_uuid, UserApp.user_uuid == user_uuid)
        .limit(1)
    )
    return (await db.execute(query)).scalar_one_or_none()


async def get_user_app_storedfile_uuids(
    db: AsyncSession, user_app_uuid: UUID | None, owner_uuid: UUID
) -> list[UUID]:
    if user_app_uuid is None:
        return []

    user_app = await get_user_app(db, user_app_uuid, owner_uuid)

    if not user_app:
        return []

    item_dict: dict = (
        user_app.content
        if isinstance(user_app.content, dict)
        else json.loads(user_app.content)
    )

    stored_file_uuids: list[str] = item_dict.get("storedFileUUIDs", [])

    file_uuids = []
    for uuid in stored_file_uuids:
        try:
            file_uuid = UUID(uuid)
        except ValueError as e:
            logger.error(e)
            continue
        file_uuids.append(file_uuid)

    return file_uuids


async def update_shared_files(
    db: AsyncSession,
    owner_uuid: UUID,
    dashboard_uuid: UUID | None = None,
    user_app_uuid: UUID | None = None,
) -> tuple[list[UUID], dict[UUID, StoredFileShare]]:
    query = select(StoredFileShare).where(StoredFileShare.creater_uuid == owner_uuid)
    if dashboard_uuid:
        query = query.where(StoredFileShare.dashboard_item_uuid == dashboard_uuid)
    elif user_app_uuid:
        query = query.where(StoredFileShare.user_app_uuid == user_app_uuid)

    file_uuids = await get_storedfile_uuids(
        db, owner_uuid, dashboard_uuid, user_app_uuid
    )

    results = (await db.execute(query)).scalars().all()

    if not results:
        return (file_uuids, {})

    existing_shares = {x.shared_user_uuid: x for x in results}

    for share in existing_shares.values():
        share.stored_file_uuids = file_uuids

    await db.commit()

    return (file_uuids, existing_shares)


async def share_files(
    db: AsyncSession,
    owner_uuid: UUID,
    user_uuids: list[UUID],
    dashboard_uuid: UUID | None = None,
    user_app_uuid: UUID | None = None,
):
    file_uuids, existing_shares = await update_shared_files(
        db, owner_uuid, dashboard_uuid=dashboard_uuid, user_app_uuid=user_app_uuid
    )

    kwargs = {}
    if dashboard_uuid:
        kwargs["dashboard_item_uuid"] = dashboard_uuid
    elif user_app_uuid:
        kwargs["user_app_uuid"] = user_app_uuid

    for user_uuid in user_uuids:
        if user_uuid in existing_shares:
            continue

        new_share = insert(StoredFileShare).values(
            dashboard_item_uuid=dashboard_uuid,
            shared_user_uuid=user_uuid,
            stored_file_uuids=file_uuids,
            creater_uuid=owner_uuid,
        )
        await db.execute(new_share)

    await db.commit()


async def unshare_files(
    db: AsyncSession,
    owner_uuid: UUID,
    user_uuids: list[UUID],
    dashboard_uuid: UUID | None = None,
    user_app_uuid: UUID | None = None,
):
    query = delete(StoredFileShare).where(
        StoredFileShare.creater_uuid == owner_uuid,
        StoredFileShare.shared_user_uuid.in_(user_uuids),
    )
    if dashboard_uuid:
        query = query.where(StoredFileShare.dashboard_item_uuid == dashboard_uuid)
    elif user_app_uuid:
        query = query.where(StoredFileShare.user_app_uuid == user_app_uuid)
    else:
        return

    await db.execute(query)
    await db.commit()


async def handle_dashboard_is_shared(
    db: AsyncSession,
    dashboard_uuid: UUID,
) -> None:
    shared_query = select(func.count(DashboardShare.uuid)).where(
        DashboardShare.dashboard_item_uuid == dashboard_uuid,
        DashboardShare.active.is_(True),
    )
    shared_count = (await db.execute(shared_query)).scalar_one_or_none() or 0

    is_shared = shared_count > 0

    await db.execute(
        update(DashboardItem)
        .where(DashboardItem.uuid == dashboard_uuid)
        .values(is_shared=is_shared)
    )
    await db.commit()


async def handle_user_app_is_shared(
    db: AsyncSession,
    app_uuid: UUID,
) -> None:
    shared_query = select(func.count(UserAppShare.uuid)).where(
        UserAppShare.user_app_uuid == app_uuid,
        UserAppShare.active.is_(True),
    )
    shared_count = (await db.execute(shared_query)).scalar_one_or_none() or 0

    is_shared = shared_count > 0

    await db.execute(
        update(UserApp).where(UserApp.uuid == app_uuid).values(is_shared=is_shared)
    )
    await db.commit()


async def get_dashboard_item(
    db: AsyncSession, dashboard_uuid: UUID, user_uuid: UUID
) -> None | models.DashboardItem:
    query = select(DashboardItem).where(
        DashboardItem.uuid == dashboard_uuid, DashboardItem.owner_uuid == user_uuid
    )
    return (await db.execute(query)).scalar_one_or_none()


async def get_user_dashboards_shared(
    db: AsyncSession, user_uuid: UUID
) -> UserDashboards:
    shared_query = select(DashboardShare.dashboard_item_uuid).where(
        DashboardShare.shared_user_uuid == user_uuid,
        DashboardShare.active.is_(True),
    )
    shared_uuids = (await db.execute(shared_query)).scalars().all()

    if not shared_uuids:
        return {}

    query = (
        select(
            DashboardItem.uuid,
            DashboardItem.content,
            DashboardItem.creator_uuid,
            DashboardItem.created_date,
            DashboardItem.updated_date,
            case(
                (
                    and_(User.first_name.is_not(None), User.last_name.is_not(None)),
                    func.concat(User.first_name, " ", User.last_name),
                ),
                else_=User.email,
            ).label("created_by"),
        )
        .join(User, User.uuid == DashboardItem.creator_uuid)
        .where(
            DashboardItem.uuid.in_(shared_uuids), DashboardItem.owner_uuid != user_uuid
        )
    )

    results = await db.execute(query)
    try:
        return {x.uuid: get_value(x, user_uuid) for x in results.all()}
    except Exception as e:
        logger.error(e)
        return {}


async def get_user_dashboards_entity_shared(
    db: AsyncSession,
    user_uuid: UUID,
    permissions_uuid: UUID,
    exclude_uuids: list[UUID] | None = None,
) -> UserDashboards:
    if (await get_users_sharing(db, [user_uuid]))[user_uuid] == models.SHARING_NONE:
        return {}

    user_entity_uuid = await get_user_entity_uuid(db, permissions_uuid)

    if not user_entity_uuid:
        return {}

    where_clause = (
        DashboardItem.entity_share.is_(True),
        DashboardItem.owner_uuid != user_uuid,
        DashboardItem.entity_uuid == user_entity_uuid,
    )
    if exclude_uuids:
        where_clause += (DashboardItem.uuid.notin_(exclude_uuids),)

    shared_query = select(DashboardItem.uuid).where(*where_clause)
    shared_uuids = (await db.execute(shared_query)).scalars().all()

    if not shared_uuids:
        return {}

    query = (
        select(
            DashboardItem.uuid,
            DashboardItem.content,
            DashboardItem.creator_uuid,
            DashboardItem.created_date,
            DashboardItem.updated_date,
            case(
                (
                    and_(User.first_name.is_not(None), User.last_name.is_not(None)),
                    func.concat(User.first_name, " ", User.last_name),
                ),
                else_=User.email,
            ).label("created_by"),
        )
        .join(User, User.uuid == DashboardItem.creator_uuid)
        .where(DashboardItem.uuid.in_(shared_uuids))
    )

    results = await db.execute(query)
    return {x.uuid: get_value(x, user_uuid) for x in results.all()}


async def dashboard_owner_errors(
    db: AsyncSession, dashboard_uuid: UUID, user_uuid: UUID
) -> None | str:
    query = (
        select(DashboardItem.owner_uuid)
        .where(DashboardItem.uuid == dashboard_uuid)
        .limit(1)
    )
    result = (await db.execute(query)).scalar_one_or_none()
    if not result:
        return "Dashboard does not exist"
    if result != user_uuid:
        return "You do not have permission to share this dashboard"
    return None


async def app_owner_errors(
    db: AsyncSession, app_uuid: UUID, user_uuid: UUID
) -> None | str:
    query = select(UserApp.user_uuid).where(UserApp.uuid == app_uuid).limit(1)
    result = (await db.execute(query)).scalar_one_or_none()
    if not result:
        return "Dashboard does not exist"
    if result != user_uuid:
        return "You do not have permission to share this app"
    return None


async def get_dashboard_saves_to_delete(
    db: AsyncSession, max_saves: int = 10
) -> list[UUID]:
    row_number_column = (
        func.row_number()
        .over(
            partition_by=DashboardSave.dashboard_item_uuid,
            order_by=DashboardSave.created_date.desc(),
        )
        .label("row_num")
    )

    windowed_subquery = select(
        DashboardSave.uuid, DashboardSave.dashboard_item_uuid, row_number_column
    ).subquery()

    select_query = select(windowed_subquery.c.uuid).where(
        windowed_subquery.c.row_num > max_saves
    )
    results = await db.execute(select_query)
    return [x for x in results.scalars().all()]


async def check_new_user(db: AsyncSession, email: str) -> bool:
    cleaned = base.clean_email(email)
    if cleaned in settings.SPECIAL_EMAILS:
        return False
    query = select(User.clean_email).where(User.clean_email == cleaned).limit(1)
    result = (await db.execute(query)).first()
    return bool(result)


async def check_clean_email(db: AsyncSession, user_email: str):
    user_clean_email = base.clean_email(user_email)
    if user_clean_email in settings.SPECIAL_EMAILS:
        return None
    user_query = select(User.uuid).where(
        User.clean_email == user_clean_email,
        User.permissions_uuid.is_not(None),
        User.deleted.is_(False),
    )
    response = (await db.execute(user_query)).first()
    if response:
        raise HTTPException(409, detail="This email already has an account registered")


async def remove_app_data(db: AsyncSession, user_uuid: UUID):
    stored_file_query = select(StoredFile).where(StoredFile.creater_uuid == user_uuid)
    stored_files = (await db.execute(stored_file_query)).scalars().all()

    for stored_file in stored_files:
        await FileStorage.delete_file(stored_file.bucket, stored_file.s3_file_name)
        await db.delete(stored_file)

    file_widgets = delete(models.FileWidget).where(
        models.FileWidget.user_uuid == user_uuid
    )
    await db.execute(file_widgets)
    api_sources = delete(ApiSource).where(ApiSource.user_uuid == user_uuid)
    await db.execute(api_sources)
    meta_data = delete(models.WidgetMetadata).where(
        models.WidgetMetadata.user_uuid == user_uuid
    )
    await db.execute(meta_data)
    user_usage = delete(models.UserUsage).where(models.UserUsage.user_uuid == user_uuid)
    await db.execute(user_usage)
    copilot_chats = delete(models.CopilotChat).where(
        models.CopilotChat.user_uuid == user_uuid
    )
    await db.execute(copilot_chats)

    mcp_servers = delete(models.MCPServers).where(
        models.MCPServers.user_uuid == user_uuid
    )
    await db.execute(mcp_servers)


async def remove_other_user_items(db: AsyncSession, user_uuid: UUID):
    user_email_query = select(User.email).where(User.uuid == user_uuid).limit(1)
    user_email = (await db.execute(user_email_query)).scalar_one_or_none()

    dash_item_query = delete(DashboardItem).where(
        or_(
            DashboardItem.creator_uuid == user_uuid,
            DashboardItem.owner_uuid == user_uuid,
        )
    )
    await db.execute(dash_item_query)
    login_query = delete(Login).where(Login.user_uuid == user_uuid)
    await db.execute(login_query)
    session_query = delete(models.Session).where(models.Session.user_uuid == user_uuid)
    await db.execute(session_query)

    try:
        if user_email:
            user_invite_query = delete(models.UserInvite).where(
                models.UserInvite.email == user_email
            )
            await db.execute(user_invite_query)
    except Exception as e:
        logger.error(e)

    user_query = delete(User).where(User.uuid == user_uuid)
    await db.execute(user_query)


async def full_delete_user(db: AsyncSession, user_uuid: UUID):
    await remove_app_data(db, user_uuid)
    await remove_other_user_items(db, user_uuid)
    await db.commit()


async def get_shares_without_existing(
    db: AsyncSession,
    share: schemas.ShareDashboard,
    dashboard_uuid: UUID,
    user_email: str,
) -> schemas.SharesPermissions:
    current_shares_query = (
        select(User.email)
        .join(DashboardShare, User.uuid == DashboardShare.shared_user_uuid)
        .where(
            DashboardShare.dashboard_item_uuid == dashboard_uuid,
            DashboardShare.active.is_(True),
        )
    )
    current_shares_response = await db.execute(current_shares_query)
    current_shares = [x for x in current_shares_response.scalars().all()]
    current_shares.append(user_email)
    return {x: y for x, y in share.shares.items() if x not in current_shares}


async def get_app_shares_without_existing(
    db: AsyncSession,
    share: schemas.ShareDashboard,
    app_uuid: UUID,
    user_email: str,
) -> schemas.SharesPermissions:
    current_shares_query = (
        select(User.email)
        .join(UserAppShare, User.uuid == UserAppShare.shared_user_uuid)
        .where(
            UserAppShare.user_app_uuid == app_uuid,
            UserAppShare.active.is_(True),
        )
    )
    current_shares_response = await db.execute(current_shares_query)
    current_shares = [x for x in current_shares_response.scalars().all()]
    current_shares.append(user_email)
    return {x: y for x, y in share.shares.items() if x not in current_shares}


class NewSharingPermission(TypedDict):
    dashboard_item_uuid: UUID
    shared_user_uuid: UUID
    permissions: schemas.permissions_type


async def get_new_sharing_permissions(
    db: AsyncSession,
    clean_shares: schemas.SharesPermissions,
    permissions_uuid: UUID,
    dashboard_uuid: UUID | None = None,
    app_uuid: UUID | None = None,
) -> tuple[list[NewSharingPermission], list[UUID]]:
    current_user_entity_query = select(PermissionsEntityMap.entity_uuid).where(
        PermissionsEntityMap.uuid == permissions_uuid
    )
    current_user_entity = await db.execute(current_user_entity_query)
    if (entity_uuid := current_user_entity.scalar()) is None:
        raise HTTPException(status_code=400, detail="The user does not have an entity")

    user_uuids_query = (
        select(User.uuid, User.email)
        .join(PermissionsEntityMap, PermissionsEntityMap.uuid == User.permissions_uuid)
        .where(
            User.email.in_(clean_shares.keys()),
            PermissionsEntityMap.entity_uuid == entity_uuid,
        )
    )
    user_uuids_response = (await db.execute(user_uuids_query)).all()

    dict_key = "dashboard_item_uuid" if dashboard_uuid else "user_app_uuid"
    permissions: list[NewSharingPermission] = [
        {
            dict_key: dashboard_uuid or app_uuid,
            "shared_user_uuid": x.uuid,
            "permissions": clean_shares.get(x.email, "view"),
        }
        for x in user_uuids_response
    ]
    return permissions, [x.uuid for x in user_uuids_response]


def _share_item(dashboard_uuid: UUID | None, app_uuid: UUID | None):
    if dashboard_uuid:
        return DashboardShare, DashboardShare.dashboard_item_uuid, dashboard_uuid
    return UserAppShare, UserAppShare.user_app_uuid, app_uuid


def _request_item(dashboard_uuid: UUID | None, app_uuid: UUID | None):
    if dashboard_uuid:
        return ShareRequest.dashboard_item_uuid == dashboard_uuid
    return ShareRequest.user_app_uuid == app_uuid


async def apply_shares(
    db: AsyncSession,
    owner_uuid: UUID,
    shares: list[NewSharingPermission],
    dashboard_uuid: UUID | None = None,
    app_uuid: UUID | None = None,
) -> None:
    share_model, item_column, item_uuid = _share_item(dashboard_uuid, app_uuid)
    recipients = [share["shared_user_uuid"] for share in shares]
    existing = dict(
        (
            await db.execute(
                select(share_model.shared_user_uuid, share_model.uuid).where(
                    item_column == item_uuid,
                    share_model.active.is_(True),
                    share_model.shared_user_uuid.in_(recipients),
                )
            )
        ).all()
    )
    new = [share for share in shares if share["shared_user_uuid"] not in existing]
    if new:
        await db.execute(insert(share_model), new)
    changed = [
        {
            "uuid": existing[share["shared_user_uuid"]],
            "permissions": share["permissions"],
        }
        for share in shares
        if share["shared_user_uuid"] in existing
    ]
    if changed:
        await db.execute(update(share_model), changed)
    if dashboard_uuid:
        await db.execute(
            update(DashboardItem)
            .where(
                DashboardItem.uuid == dashboard_uuid,
                DashboardItem.owner_uuid == owner_uuid,
            )
            .values(is_shared=True)
        )
    else:
        await db.execute(
            update(UserApp)
            .where(UserApp.uuid == app_uuid, UserApp.user_uuid == owner_uuid)
            .values(is_shared=True)
        )
    await db.commit()
    await share_files(
        db,
        owner_uuid,
        [share["shared_user_uuid"] for share in new],
        dashboard_uuid=dashboard_uuid,
        user_app_uuid=app_uuid,
    )


async def request_shares(
    db: AsyncSession,
    requester_uuid: UUID,
    shares: list[NewSharingPermission],
    dashboard_uuid: UUID | None = None,
    app_uuid: UUID | None = None,
) -> None:
    recipients = [share["shared_user_uuid"] for share in shares]
    await db.execute(
        delete(ShareRequest).where(
            _request_item(dashboard_uuid, app_uuid),
            ShareRequest.recipient_uuid.in_(recipients),
        )
    )
    await db.execute(
        insert(ShareRequest),
        [
            {
                "requester_uuid": requester_uuid,
                "dashboard_item_uuid": dashboard_uuid,
                "user_app_uuid": app_uuid,
                "recipient_uuid": share["shared_user_uuid"],
                "permissions": share["permissions"],
            }
            for share in shares
        ],
    )
    await db.commit()


async def request_entity_share(
    db: AsyncSession, requester_uuid: UUID, dashboard_uuid: UUID
) -> None:
    await db.execute(
        delete(ShareRequest).where(
            ShareRequest.dashboard_item_uuid == dashboard_uuid,
            ShareRequest.recipient_uuid.is_(None),
        )
    )
    await db.execute(
        insert(ShareRequest).values(
            requester_uuid=requester_uuid, dashboard_item_uuid=dashboard_uuid
        )
    )
    await db.commit()


async def cancel_share_requests(
    db: AsyncSession,
    requester_uuid: UUID,
    emails: list[str],
    dashboard_uuid: UUID | None = None,
    app_uuid: UUID | None = None,
) -> None:
    await db.execute(
        delete(ShareRequest).where(
            _request_item(dashboard_uuid, app_uuid),
            ShareRequest.requester_uuid == requester_uuid,
            ShareRequest.recipient_uuid.in_(
                select(User.uuid).where(User.email.in_(emails))
            ),
        )
    )
    await db.commit()


async def get_waiting_shares(
    db: AsyncSession,
    requester_uuid: UUID,
    dashboard_uuid: UUID | None = None,
    app_uuid: UUID | None = None,
):
    query = (
        select(
            User.email,
            User.first_name,
            User.last_name,
            ShareRequest.permissions,
            ShareRequest.created_date,
        )
        .join(User, User.uuid == ShareRequest.recipient_uuid)
        .where(
            _request_item(dashboard_uuid, app_uuid),
            ShareRequest.requester_uuid == requester_uuid,
        )
    )
    return (await db.execute(query)).mappings().all()


async def approve_share_request(db: AsyncSession, share_request: ShareRequest) -> None:
    requester_uuid = share_request.requester_uuid
    sharing = await get_users_sharing(db, [requester_uuid])
    if sharing[requester_uuid] != models.SHARING_SHARE:
        raise HTTPException(409, detail="The requester's roles no longer allow sharing")

    dashboard_uuid = share_request.dashboard_item_uuid
    app_uuid = share_request.user_app_uuid
    if dashboard_uuid:
        owner_query = select(DashboardItem.owner_uuid).where(
            DashboardItem.uuid == dashboard_uuid
        )
    else:
        owner_query = select(UserApp.user_uuid).where(UserApp.uuid == app_uuid)
    if (await db.execute(owner_query)).scalar_one_or_none() != requester_uuid:
        raise HTTPException(409, detail="The requester no longer owns this item")

    recipient_uuid = share_request.recipient_uuid
    if recipient_uuid is None:
        await db.execute(
            update(DashboardItem)
            .where(DashboardItem.uuid == dashboard_uuid)
            .values(entity_share=True)
        )
    else:
        entities_query = (
            select(User.uuid, PermissionsEntityMap.entity_uuid)
            .join(PermissionsEntityMap, PermissionsEntityMap.uuid == User.permissions_uuid)
            .where(User.uuid.in_([requester_uuid, recipient_uuid]))
        )
        entities = dict((await db.execute(entities_query)).all())
        recipient_entity = entities.get(recipient_uuid)
        if recipient_entity is None or recipient_entity != entities.get(requester_uuid):
            raise HTTPException(
                409, detail="The recipient is no longer in the organization"
            )
        receiving = await get_users_sharing(db, [recipient_uuid])
        if receiving[recipient_uuid] == models.SHARING_NONE:
            raise HTTPException(
                409, detail="The recipient's roles do not allow receiving shares"
            )
        item_key = "dashboard_item_uuid" if dashboard_uuid else "user_app_uuid"
        shares: list[NewSharingPermission] = [
            {
                item_key: dashboard_uuid or app_uuid,
                "shared_user_uuid": recipient_uuid,
                "permissions": share_request.permissions or "view",
            }
        ]
        await apply_shares(
            db, requester_uuid, shares, dashboard_uuid=dashboard_uuid, app_uuid=app_uuid
        )

    await db.execute(
        delete(ShareRequest).where(ShareRequest.uuid == share_request.uuid)
    )
    await db.commit()


async def remove_shares_both_ways(
    db: AsyncSession, user_uuid: None | UUID = None, email: None | str = None
):
    if user_uuid is None:
        user_uuid_query = select(User.uuid).where(User.email == email)
        user_uuid_response = (await db.execute(user_uuid_query)).first()
        if user_uuid_response is None:
            raise HTTPException(status_code=400, detail="The user could not be found")
        user_uuid = user_uuid_response[0]

    dash_item_uuids_query = select(DashboardItem.uuid).where(
        DashboardItem.owner_uuid == user_uuid
    )
    dash_item_uuids = (await db.execute(dash_item_uuids_query)).scalars().all()
    await db.execute(
        delete(DashboardShare).where(
            DashboardShare.dashboard_item_uuid.in_(dash_item_uuids)
        )
    )

    await db.execute(
        delete(DashboardShare).where(DashboardShare.shared_user_uuid == user_uuid)
    )

    user_app_uuids = (
        (await db.execute(select(UserApp.uuid).where(UserApp.user_uuid == user_uuid)))
        .scalars()
        .all()
    )
    await db.execute(
        delete(UserAppShare).where(UserAppShare.user_app_uuid.in_(user_app_uuids))
    )

    await db.execute(
        delete(ShareRequest).where(
            or_(
                ShareRequest.requester_uuid == user_uuid,
                ShareRequest.recipient_uuid == user_uuid,
            )
        )
    )


async def get_users_sharing(
    db: AsyncSession, user_uuids: list[UUID]
) -> dict[UUID, str]:
    levels = dict.fromkeys(user_uuids, models.SHARING_NONE)
    if not user_uuids:
        return levels

    query = (
        select(models.UserRole.user_uuid, models.Role.sharing)
        .join(models.Role, models.Role.uuid == models.UserRole.role_uuid)
        .join(User, User.uuid == models.UserRole.user_uuid)
        .join(PermissionsEntityMap, PermissionsEntityMap.uuid == User.permissions_uuid)
        .join(Entity, Entity.uuid == PermissionsEntityMap.entity_uuid)
        .where(
            models.UserRole.user_uuid.in_(user_uuids),
            models.Role.deleted_at.is_(None),
            models.Role.entity_uuid == Entity.uuid,
            Entity.sharing_enabled.is_(True),
        )
    )
    for user_uuid, sharing in (await db.execute(query)).all():
        if models.SHARING_LEVELS.index(sharing) > models.SHARING_LEVELS.index(
            levels[user_uuid]
        ):
            levels[user_uuid] = sharing
    return levels


async def leave_other_organizations(db: AsyncSession, user_uuid: UUID) -> None:
    entity_uuid = (
        await db.execute(
            select(PermissionsEntityMap.entity_uuid)
            .join(User, User.permissions_uuid == PermissionsEntityMap.uuid)
            .where(User.uuid == user_uuid)
        )
    ).scalar_one_or_none()
    other_roles = select(models.Role.uuid)
    if entity_uuid is not None:
        other_roles = other_roles.where(models.Role.entity_uuid != entity_uuid)

    query = select(models.UserRole).where(
        models.UserRole.user_uuid == user_uuid,
        models.UserRole.role_uuid.in_(other_roles),
    )
    for user_role in (await db.execute(query)).scalars().all():
        await db.delete(user_role)

    for grant, item_uuid, item in (
        (models.RoleBackend, models.RoleBackend.backend_uuid, ApiSource),
        (models.RoleFile, models.RoleFile.file_uuid, models.FileWidget),
        (models.RolePrompt, models.RolePrompt.prompt_uuid, models.UserPrompts),
    ):
        await db.execute(
            delete(grant).where(
                grant.role_uuid.in_(other_roles),
                item_uuid.in_(select(item.uuid).where(item.user_uuid == user_uuid)),
            )
        )
    await db.commit()


async def check_may_share(db: AsyncSession, user_uuid: UUID) -> None:
    if (await get_users_sharing(db, [user_uuid]))[user_uuid] != models.SHARING_SHARE:
        raise HTTPException(403, detail="Sharing is not allowed for your account")


async def check_share_recipients(db: AsyncSession, user_uuids: list[UUID]) -> None:
    levels = await get_users_sharing(db, user_uuids)
    refused = [uuid for uuid, level in levels.items() if level == models.SHARING_NONE]
    if refused:
        emails = (
            (
                await db.execute(
                    select(User.email).where(User.uuid.in_(refused)).order_by(User.email)
                )
            )
            .scalars()
            .all()
        )
        raise HTTPException(
            403,
            detail=f"These users cannot receive shared items: {', '.join(emails)}",
        )


async def get_share_recipients(
    db: AsyncSession, user_uuids: list[UUID]
) -> list[UUID]:
    levels = await get_users_sharing(db, user_uuids)
    return [uuid for uuid, level in levels.items() if level != models.SHARING_NONE]


async def revoke_disallowed_shares(db: AsyncSession, user_uuids: list[UUID]) -> None:
    levels = await get_users_sharing(db, list(user_uuids))
    sharers = [uuid for uuid, level in levels.items() if level != models.SHARING_SHARE]
    receivers = [uuid for uuid, level in levels.items() if level == models.SHARING_NONE]

    if sharers or receivers:
        await db.execute(
            delete(ShareRequest).where(
                or_(
                    ShareRequest.requester_uuid.in_(sharers),
                    ShareRequest.recipient_uuid.in_(receivers),
                )
            )
        )

    if sharers:
        dashboard_uuids = (
            (
                await db.execute(
                    select(DashboardItem.uuid).where(
                        DashboardItem.owner_uuid.in_(sharers)
                    )
                )
            )
            .scalars()
            .all()
        )
        app_uuids = (
            (await db.execute(select(UserApp.uuid).where(UserApp.user_uuid.in_(sharers))))
            .scalars()
            .all()
        )
        await db.execute(
            delete(DashboardShare).where(
                DashboardShare.dashboard_item_uuid.in_(dashboard_uuids)
            )
        )
        await db.execute(
            delete(UserAppShare).where(UserAppShare.user_app_uuid.in_(app_uuids))
        )
        await db.execute(
            delete(StoredFileShare).where(StoredFileShare.creater_uuid.in_(sharers))
        )
        await db.execute(
            update(DashboardItem)
            .where(DashboardItem.owner_uuid.in_(sharers))
            .values(entity_share=False, is_shared=False)
        )
        await db.execute(
            update(UserApp).where(UserApp.user_uuid.in_(sharers)).values(is_shared=False)
        )

    received_dashboards: list[UUID] = []
    received_apps: list[UUID] = []
    if receivers:
        received_dashboards = (
            (
                await db.execute(
                    select(DashboardShare.dashboard_item_uuid)
                    .where(DashboardShare.shared_user_uuid.in_(receivers))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        received_apps = (
            (
                await db.execute(
                    select(UserAppShare.user_app_uuid)
                    .where(UserAppShare.shared_user_uuid.in_(receivers))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        await db.execute(
            delete(DashboardShare).where(DashboardShare.shared_user_uuid.in_(receivers))
        )
        await db.execute(
            delete(UserAppShare).where(UserAppShare.shared_user_uuid.in_(receivers))
        )
        await db.execute(
            delete(StoredFileShare).where(
                StoredFileShare.shared_user_uuid.in_(receivers)
            )
        )

    await db.commit()

    for dashboard_uuid in received_dashboards:
        await handle_dashboard_is_shared(db, dashboard_uuid)
    for app_uuid in received_apps:
        await handle_user_app_is_shared(db, app_uuid)


async def update_user_dashboards_new_entity(
    db: AsyncSession, user_uuid: UUID, new_entity_uuid: UUID | None = None
):
    query = (
        update(DashboardItem)
        .where(DashboardItem.owner_uuid == user_uuid)
        .values(entity_uuid=new_entity_uuid)
    )
    await db.execute(query)
    await db.commit()


UserApps = dict[UUID, schemas.UserAppReturn]


async def get_user_apps_shared(db: AsyncSession, user_uuid: UUID) -> UserApps:
    shared_query = select(UserAppShare.user_app_uuid).where(
        UserAppShare.shared_user_uuid == user_uuid,
        UserAppShare.active.is_(True),
    )
    shared_uuids = (await db.execute(shared_query)).scalars().all()

    if not shared_uuids:
        return {}

    query = (
        select(
            UserApp.uuid,
            UserApp.content,
            UserApp.user_uuid.label("creator_uuid"),
            UserApp.created_date,
            UserApp.updated_date,
            case(
                (
                    and_(User.first_name.is_not(None), User.last_name.is_not(None)),
                    func.concat(User.first_name, " ", User.last_name),
                ),
                else_=User.email,
            ).label("created_by"),
        )
        .join(User, User.uuid == UserApp.user_uuid)
        .where(UserApp.uuid.in_(shared_uuids), UserApp.user_uuid != user_uuid)
    )

    results = await db.execute(query)
    try:
        return {
            x.uuid: get_value(x, user_uuid, schemas.UserAppReturn)
            for x in results.all()
        }
    except Exception as e:
        logger.error(e)
        return {}


async def get_user_apps_owned(db: AsyncSession, user_uuid: UUID) -> UserApps:
    query = (
        select(
            UserApp.uuid,
            UserApp.content,
            UserApp.user_uuid.label("creator_uuid"),
            UserApp.created_date,
            UserApp.updated_date,
            UserApp.is_shared,
            case(
                (
                    and_(User.first_name.is_not(None), User.last_name.is_not(None)),
                    func.concat(User.first_name, " ", User.last_name),
                ),
                else_=User.email,
            ).label("created_by"),
        )
        .join(User, User.uuid == UserApp.user_uuid)
        .where(UserApp.user_uuid == user_uuid)
    )

    shared_with_query = (
        select(UserAppShare.user_app_uuid, User.first_name, User.last_name, User.email)
        .join(User, User.uuid == UserAppShare.shared_user_uuid)
        .where(
            UserAppShare.shared_user_uuid != user_uuid,
            UserAppShare.active.is_(True),
            UserAppShare.permissions == "view",
        )
    )

    results = (await db.execute(query)).all()

    shared_with_results = await db.execute(shared_with_query)
    shared_with_map: dict[UUID, list[dict[str, str]]] = {}

    for row in shared_with_results.all():
        full_name = (
            f"{row.first_name} {row.last_name}"
            if row.first_name and row.last_name
            else row.email
        )
        shared_with_map.setdefault(row.user_app_uuid, []).append(
            {"name": full_name, "email": row.email}
        )

    for x in results:
        x.content["shared_with"] = shared_with_map.get(x.uuid, [])

    return {x.uuid: get_value(x, user_uuid, schemas.UserAppReturn) for x in results}
