from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import delete, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, crud, helpers, models, schemas
from api.database import aget_read_db, aget_write_db
from api.models import ApiSource, FileWidget
from api.models.workspace_models import StoredFile
from api.schemas import SuccessReturn
from api.storage import FileStorage
from routers import app_helpers
from utilities.config import settings

router = APIRouter(
    prefix="/app/data-connectors",
    tags=["app-data-connectors"],
)


@router.get("/file", response_model=list[schemas.ReturnFileWidget])
async def get_user_file_widgets(
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    if not await app_helpers.may_add_connections(db, user.uuid):
        return []
    select_query = select(FileWidget).where(FileWidget.user_uuid == user.uuid)
    return (await db.execute(select_query)).scalars().all()


@router.post("/file/{widget_uuid}", response_model=schemas.SuccessReturn)
async def post_user_file_widget(
    widget_uuid: Annotated[
        UUID, Path(..., description="The UUID of the widget to create or update")
    ],
    payload: schemas.CreateFileWidget,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    await app_helpers.check_may_add_connections(db, user.uuid)
    cache = settings.redis_cache(payload.stored_file_uuid)
    query = await db.execute(
        select(StoredFile).where(StoredFile.file_widget_uuid == widget_uuid)
    )
    stored_file = query.scalar_one_or_none()

    if stored_file is None and not cache:
        raise HTTPException(404, detail="File not found")

    data = payload.model_dump(exclude={"stored_file_uuid"})

    insert_query = insert(FileWidget).values(
        uuid=widget_uuid, user_uuid=user.uuid, **data
    )
    update_query = (
        update(FileWidget)
        .where(FileWidget.uuid == widget_uuid, FileWidget.user_uuid == user.uuid)
        .values(**data)
    )

    final_query = insert_query if stored_file is None else update_query

    try:
        await db.execute(final_query)
    except IntegrityError as exc:
        helpers.handle_duplicate_pk(exc)
        await db.execute(update_query)

    if stored_file is None:
        confirm_query = (
            update(StoredFile)
            .where(StoredFile.uuid == payload.stored_file_uuid)
            .values(
                file_widget_uuid=widget_uuid,
            )
        )
        await db.execute(confirm_query)
        settings.redis_cache(payload.stored_file_uuid, delete=True)

    await db.commit()
    return {"success": True}


@router.delete("/file/{widget_uuid}", response_model=schemas.SuccessReturn)
async def delete_user_file_widget(
    widget_uuid: Annotated[
        UUID, Path(..., description="The UUID of the widget to delete")
    ],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    stored_file_query = select(StoredFile).where(
        StoredFile.file_widget_uuid == widget_uuid
    )
    stored_file = (await db.execute(stored_file_query)).scalar_one_or_none()

    if stored_file and not await FileStorage.delete_file(
        stored_file.bucket, stored_file.s3_file_name
    ):
        stored_file.file_widget_uuid = None
        await db.commit()

    query = delete(FileWidget).where(
        FileWidget.uuid == widget_uuid, FileWidget.user_uuid == user.uuid
    )
    await db.execute(query)
    await db.commit()
    return {"success": True}


@router.get("/stored-files", response_model=list[schemas.StoredFileReturn])
async def get_stored_files(
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    if not await app_helpers.may_add_connections(db, user.uuid):
        return []
    select_query = select(StoredFile).where(StoredFile.creater_uuid == user.uuid)
    return (await db.execute(select_query)).scalars().all()


@router.get("/api-source", response_model=list[schemas.ReturnApiSource])
async def get_user_api_sources(
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    filters = ()
    if (
        await app_helpers.get_user_type(db, user.uuid) == models.ADMIN_TYPE
        and (entity_uuid := await crud.get_user_entity_uuid(db, user.permissions_uuid))
        is not None
    ):
        filters += (ApiSource.entity_uuid == entity_uuid,)
    if await app_helpers.may_add_connections(db, user.uuid):
        filters += (ApiSource.user_uuid == user.uuid,)
    if not filters:
        return []

    select_query = (
        select(ApiSource).where(or_(*filters)).order_by(ApiSource.updated_date.desc())
    )
    return (await db.execute(select_query)).scalars().all()


@router.post("/api-source/{source_uuid}", response_model=SuccessReturn)
async def post_user_api_source(
    source_uuid: Annotated[
        UUID, Path(..., description="The UUID of the source to create or update")
    ],
    payload: schemas.CreateApiSource,
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    await app_helpers.check_may_add_connections(db, user.uuid)
    insert_query = insert(ApiSource).values(
        uuid=source_uuid, user_uuid=user.uuid, **payload.model_dump()
    )
    try:
        await db.execute(insert_query)
    except IntegrityError as exc:
        helpers.handle_duplicate_pk(exc)
        update_query = (
            update(ApiSource)
            .where(ApiSource.uuid == source_uuid, ApiSource.user_uuid == user.uuid)
            .values(**payload.model_dump())
        )
        await db.execute(update_query)

    await db.commit()
    return SuccessReturn.success_instance()


@router.delete("/api-source/{source_uuid}", response_model=SuccessReturn)
async def delete_user_api_source(
    source_uuid: Annotated[
        UUID, Path(..., description="The UUID of the source to delete")
    ],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    query = delete(ApiSource).where(
        ApiSource.uuid == source_uuid, ApiSource.user_uuid == user.uuid
    )
    await db.execute(query)
    await db.commit()
    return SuccessReturn.success_instance()
