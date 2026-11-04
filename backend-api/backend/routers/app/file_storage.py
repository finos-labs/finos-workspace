import asyncio
import contextlib
import io
import json
from datetime import timedelta
from typing import Annotated, Any
from uuid import UUID, uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Body, Depends, File, HTTPException, Path, Query, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy import false, func, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from api import auth_helpers, schemas
from api.database import aget_read_db, aget_write_db
from api.helpers import refresh_usage_cache
from api.models.workspace_models import PostStoredFile, StoredFile
from api.schemas import SuccessReturn
from api.storage import FileStorage
from routers.app.helpers import (
    check_may_add_connections,
    get_shared_file_uuids,
    get_user_limits,
)
from utilities.config import settings

router = APIRouter(
    prefix="/app",
    tags=["app-file-storage"],
)
signed_router = APIRouter(prefix="/app", tags=["app-file-storage"])


async def check_upload_limit(
    db: AsyncSession, user_uuid: UUID, files: list[UploadFile]
) -> None:
    limit = (await get_user_limits(db, user_uuid)).upload_size_gb
    if limit is None:
        return

    used_query = select(func.sum(StoredFile.size)).where(
        StoredFile.creater_uuid == user_uuid
    )
    total_bytes = (await db.execute(used_query)).scalar_one_or_none() or 0
    for item in files:
        if not item.filename:
            continue
        item.file.seek(0, io.SEEK_END)
        total_bytes += item.file.tell()
        item.file.seek(0)

    if total_bytes / (1024**3) > limit:
        raise HTTPException(
            413, detail=f"The upload size limit of {limit} GB would be exceeded"
        )


@router.post(
    "/files",
    response_model=list[schemas.PendingFileReturn],
    summary="Upload files",
    description=(
        "Uploads the files of a multipart request to the storage and returns a description of each one, including "
        "whether its upload failed. An uploaded file stays pending until a file widget claims it. Answers 403 when the "
        "user's type may not add connections and 413 when the upload would exceed the user's upload size limit."
    ),
)
async def post_files(
    files: Annotated[list[UploadFile], File(description="The files to upload.")],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    await check_may_add_connections(db, user.uuid)
    await check_upload_limit(db, user.uuid, files)

    tasks = []
    for item in files:
        if not item.filename:
            continue

        file_ending = item.filename.split(".")[-1].lower()
        s3_file = f"{uuid4()}.{file_ending}"

        fs = await item.read()
        filesize = len(fs)

        model = schemas.StoredFileSchema(
            creater_uuid=user.uuid,
            s3_file_name=s3_file,
            bucket=settings.get_file_bucket(),
            original_file_name=item.filename,
            extension=file_ending,
            size=filesize,
        )

        item.file.seek(0)
        tasks.append(
            asyncio.create_task(FileStorage.upload_pending_file(item.file, model))
        )

    gathered: list[schemas.StoredFileSchema] = await asyncio.gather(*tasks)

    processed_files: list[schemas.StoredFileSchema] = []
    for item in gathered:
        if not isinstance(item, schemas.StoredFileSchema):
            continue

        processed_files.append(item.as_return())

        if item.failed:
            continue

        try:
            pending_dict = item.model_dump(exclude={"failed"})
            await db.execute(insert(StoredFile).values(**pending_dict))
            await db.commit()

            settings.redis_cache(item.uuid, pending_dict, timedelta(days=1))

        except Exception as exc:
            logger.exception(exc)
            await FileStorage.delete_file(settings.get_file_bucket(), item.s3_file_name)

    refresh_usage_cache(user.uuid)
    return processed_files


async def get_user_stored_file(
    file_name: str, user: Any | None, db: AsyncSession
) -> StoredFile:
    file_uuid = file_name.split(".", maxsplit=1)[0]
    user_uuid = getattr(user, "uuid", None)

    checks = [StoredFile.s3_file_name == file_name]

    with contextlib.suppress(ValueError):
        uuid_obj = UUID(file_uuid)
        checks.append(StoredFile.uuid == uuid_obj)

    query = select(StoredFile).where(or_(*checks))

    if user is not None:
        shared_file_uuids = await get_shared_file_uuids(db, user)
        query = query.where(
            or_(
                StoredFile.creater_uuid == user_uuid,
                StoredFile.is_global.is_(True),
                StoredFile.uuid.in_(shared_file_uuids),
            ),
        )

    query_file = await db.execute(query.limit(1))

    stored_file = query_file.scalar_one_or_none()
    if not stored_file and (cache := settings.redis_cache(file_uuid)):
        stored_file = schemas.StoredFileSchema(**cache)
        if user_uuid and stored_file.creater_uuid != user_uuid:
            raise HTTPException(403, detail="User does not have access to this file")

    if not stored_file or not await FileStorage.check_file_exists(stored_file):
        raise HTTPException(404, detail="File not found")

    return stored_file


@router.get(
    "/files/{file_name}",
    response_class=StreamingResponse,
    summary="Download a file",
    description=(
        "Streams the file with the given name or UUID. The user can read the files that they uploaded, the global "
        "files, and the files that others shared with them. Answers 404 when no such file is available to the user."
    ),
)
async def get_file(
    file_name: Annotated[str, Path(description="The name of the file in the storage, or its UUID.")],
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    stored_file = await get_user_stored_file(file_name, user, db)

    return FileStorage.get_stream(stored_file)


@signed_router.get(
    "/files/presigned/{file_name}",
    response_class=StreamingResponse,
    summary="Download a file through a signed link",
    description=(
        "Streams a file when `Expires` and `Signature` form a valid signed link, and needs no session. Answers 403 when "
        "the link is invalid or has expired and 404 when the file does not exist."
    ),
)
async def get_signed_file(
    file_name: Annotated[str, Path(description="The name of the file in the storage, as the signed link carries it.")],
    Expires: Annotated[
        int, Query(description="The time at which the link expires, in seconds since 1970, as the link carries it.")
    ],
    Signature: Annotated[str, Query(description="The signature of the link, as the link carries it.")],
    db: AsyncSession = Depends(aget_read_db),
):
    if (
        storage_info := FileStorage.validate_presigned_url(
            file_name, Expires, Signature
        )
    ) is None:
        raise HTTPException(403, detail="Invalid or expired pre-signed URL")

    stored_file = await get_user_stored_file(storage_info["s3_file_name"], None, db)
    return FileStorage.get_stream(stored_file)


PRESIGNED_URL_MAX_SECONDS = 900


@router.get(
    "/files/{file_name}/presigned-url",
    response_model=schemas.PreSignedUrlReturn,
    summary="Create a signed download link",
    description=(
        f"Returns a signed link to the file, together with the file's details. The link works without a session until "
        f"`expiration` seconds have passed, and the API caps the lifetime at {PRESIGNED_URL_MAX_SECONDS} seconds. "
        f"Answers 404 when no such file is available to the user."
    ),
)
async def get_presigned_url(
    file_name: Annotated[str, Path(description="The name of the file in the storage, or its UUID.")],
    expiration: Annotated[
        int,
        Query(ge=1, description="How many seconds the link stays valid. The API lowers a larger value to its maximum."),
    ] = PRESIGNED_URL_MAX_SECONDS,
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    stored_file = await get_user_stored_file(file_name, user, db)
    presign_url = await FileStorage.create_presigned_url(
        stored_file.bucket,
        stored_file.s3_file_name,
        min(expiration, PRESIGNED_URL_MAX_SECONDS),
    )

    return schemas.PreSignedUrlReturn(
        **stored_file.__dict__, pre_signed_url=presign_url
    )


@router.delete(
    "/files/{file_uuid}",
    response_model=SuccessReturn,
    summary="Delete a file",
    description=(
        "Deletes one of the user's own stored files. Answers 404 when the user has no file with that UUID and 400 when "
        "the storage cannot delete it."
    ),
)
async def delete_file(
    file_uuid: Annotated[UUID, Path(description="The UUID of the stored file.")],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    select_query = select(StoredFile).where(
        StoredFile.uuid == file_uuid, StoredFile.creater_uuid == user.uuid
    )
    results = await db.execute(select_query)
    if not (result := results.scalar_one_or_none()):
        raise HTTPException(404, detail="File not found")

    if not await FileStorage.delete_file(result.bucket, result.s3_file_name):
        raise HTTPException(400, detail="Unable to delete file")

    await db.delete(result)
    await db.commit()

    refresh_usage_cache(user.uuid)
    return SuccessReturn.success_instance()


@router.delete(
    "/files",
    response_model=SuccessReturn,
    summary="Delete several files",
    description=(
        "Deletes the user's own stored files whose UUIDs are in the request. A file that the storage cannot delete is "
        "kept and detached from its widget. Answers 404 when none of the files belongs to the user."
    ),
)
async def delete_files(
    data: Annotated[
        schemas.DeleteStoredFiles, Body(..., description="The files to delete")
    ],
    user=Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_write_db),
):
    select_query = select(StoredFile).where(
        StoredFile.uuid.in_(data.file_uuids),
        StoredFile.creater_uuid == user.uuid,
    )
    query_results = await db.execute(select_query)
    if not (results := query_results.scalars().all()):
        raise HTTPException(404, detail="Files not found")

    tasks = [
        asyncio.create_task(
            FileStorage.delete_file(
                result.bucket,
                result.s3_file_name,
            )
        )
        for result in results
    ]

    gathered = await asyncio.gather(*tasks, return_exceptions=True)
    for idx, item in enumerate(gathered):
        instance = results[idx]

        if isinstance(item, Exception):
            logger.error(f"Failed to delete file: {results[idx].s3_file_name}")
            if isinstance(instance, StoredFile):
                instance.file_widget_uuid = None
            continue

        await db.delete(instance)

    await db.commit()

    refresh_usage_cache(user.uuid)
    return SuccessReturn.success_instance()


@router.post(
    "/files/download",
    response_class=StreamingResponse,
    summary="Download files as a ZIP archive",
    description=(
        "Returns a ZIP archive that holds the requested files and a `file_manifest.json` that lists them. The user can "
        "request the files that they uploaded, the global files, and the files that others shared with them. Answers "
        "404 when no file is found."
    ),
)
async def get_files(
    files: Annotated[
        list[PostStoredFile], Body(..., description="The files to download")
    ],
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "permissions_uuid"], app_session=True)),
    db: AsyncSession = Depends(aget_read_db),
):
    shared_file_uuids = await get_shared_file_uuids(db, user)

    stored_file_query = (
        select(StoredFile)
        .where(or_(false(), *[f.filter_element() for f in files]))
        .where(
            or_(
                StoredFile.creater_uuid == user.uuid,
                StoredFile.is_global.is_(True),
                StoredFile.uuid.in_(shared_file_uuids),
            )
        )
    )
    stored_files = (await db.execute(stored_file_query)).scalars().all()

    tasks: list[asyncio.Task[bytes]] = []
    file_manifests: list[schemas.DownloadManifest] = []
    for file in files:
        file_dict = {"s3_file_name": "", "manifest": {}}
        model: StoredFile | None = file.to_stored_file(stored_files)

        if isinstance(model, StoredFile):
            file_dict.update(
                s3_file_name=model.s3_file_name,
                manifest=schemas.DownloadManifest.model_validate(model),
            )
        elif file.filename:
            file_dict.update(
                s3_file_name=file.filename,
                manifest=schemas.DownloadManifest(
                    **{
                        "file_name": file.filename,
                        "original_file_name": file.filename,
                        "extension": file.filename.split(".")[-1],
                    }
                ),
            )

        if not file_dict["s3_file_name"]:
            continue

        s3_file_name, manifest = file_dict.values()
        file_manifests.append(manifest)
        tasks.append(
            asyncio.create_task(
                FileStorage.get_file(settings.get_file_bucket(), s3_file_name)
            )
        )

    zip_io = io.BytesIO()
    file_name = ""

    failed_indexes = []
    with (ZipFile(zip_io, mode="w", compression=ZIP_DEFLATED) as tmp_zip,):
        gathered = await asyncio.gather(*tasks, return_exceptions=True)
        for idx, item in enumerate(gathered):
            file_name = file_manifests[idx].file_name

            if isinstance(item, Exception) or item is None:
                logger.error(f"Failed to download file: {file_name}")
                failed_indexes.append(idx)
                continue

            tmp_zip.writestr(file_name, item)

        for idx in failed_indexes:
            file_manifests.pop(idx)

        tmp_zip.writestr(
            "file_manifest.json", json.dumps(jsonable_encoder(file_manifests))
        )

    total_files = len(file_manifests)
    if total_files == 0:
        raise HTTPException(404, detail="No files found")

    return StreamingResponse(
        iter([zip_io.getvalue()]),
        media_type="application/x-zip-compressed",
        headers={
            "Content-Disposition": f"attachment; filename={user.uuid}_files_{total_files}.zip",
        },
        background=BackgroundTask(zip_io.close),
    )
