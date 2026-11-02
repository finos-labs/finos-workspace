import asyncio
from http import HTTPStatus
from mimetypes import guess_type
from typing import Any, BinaryIO
from urllib.parse import quote as parse_quote

from aiohttp import ClientResponseError
from fastapi.responses import StreamingResponse
from gcloud.aio.auth.token import GCE_METADATA_BASE
from gcloud.aio.storage import Bucket, Storage
from loguru import logger

from api.schemas import StoredFileSchema
from api.storage import StorageAbstract

METADATA_EMAIL_URL = f"{GCE_METADATA_BASE}/instance/service-accounts/default/email"
STREAM_CHUNK_BYTES = 1024 * 1024


class GCSClients:
    loop: asyncio.AbstractEventLoop | None = None
    client: Storage | None = None

    @classmethod
    def get(cls) -> Storage:
        loop = asyncio.get_running_loop()
        if cls.client is None or cls.loop is not loop:
            cls.loop = loop
            cls.client = Storage()
        return cls.client

    @classmethod
    async def close(cls) -> None:
        if cls.client is not None and cls.loop is asyncio.get_running_loop():
            await cls.client.close()
        cls.client = None
        cls.loop = None


class GCSStream(StreamingResponse):
    def __init__(self, store_file: StoredFileSchema, **kwargs: Any) -> None:
        parsed_file_name = parse_quote(store_file.original_file_name)
        kwargs["headers"] = {"Content-Disposition": f'attachment; filename="{parsed_file_name}"'}

        media_type, _ = guess_type(store_file.original_file_name)
        if media_type is not None:
            kwargs["media_type"] = media_type

        super().__init__(None, 200, **kwargs)

        self.s3_file = store_file.s3_file_name
        self.bucket = store_file.bucket

    async def stream_response(self, send) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": self.status_code,
                "headers": self.raw_headers,
            }
        )

        try:
            stream = await GCSClients.get().download_stream(self.bucket, self.s3_file)
            while chunk := await stream.read(STREAM_CHUNK_BYTES):
                await send({"type": "http.response.body", "body": chunk, "more_body": True})
        except Exception as e:
            logger.error(f"Failed to stream {self.s3_file} from Google Cloud Storage: {e}")

        await send({"type": "http.response.body", "body": b"", "more_body": False})


async def service_account_email(client: Storage, metadata_url: str = METADATA_EMAIL_URL) -> str | None:
    if email := client.token.service_data.get("client_email"):
        return str(email)
    async with client.session.session.get(metadata_url, headers={"Metadata-Flavor": "Google"}) as response:
        response.raise_for_status()
        return (await response.text()).strip() or None


def is_missing(error: Exception) -> bool:
    return isinstance(error, ClientResponseError) and error.status == HTTPStatus.NOT_FOUND


class GCPStorage(StorageAbstract):
    @staticmethod
    async def create_presigned_url(bucket_name: str, object_name: str, expiration: int = 3600) -> None | str:
        try:
            client = GCSClients.get()
            blob = Bucket(client, bucket_name).new_blob(object_name)
            if client.token.service_data.get("private_key"):
                return await blob.get_signed_url(expiration)
            return await blob.get_signed_url(
                expiration, service_account_email=await service_account_email(client)
            )
        except Exception as e:
            logger.error(f"Failed to sign a Google Cloud Storage URL: {e}")
        return None

    @staticmethod
    async def upload_file(local_file: BinaryIO, bucket: str, s3_file: str) -> bool:
        try:
            await GCSClients.get().upload(bucket, s3_file, local_file)
            return True
        except Exception as e:
            logger.error(f"Failed to upload {s3_file} to Google Cloud Storage: {e}")
        return False

    @staticmethod
    async def upload_pending_file(local_file: BinaryIO, pending_file: StoredFileSchema) -> StoredFileSchema:
        try:
            await GCSClients.get().upload(pending_file.bucket, pending_file.s3_file_name, local_file)
            return pending_file
        except Exception as e:
            logger.error(f"Failed to upload {pending_file.s3_file_name} to Google Cloud Storage: {e}")

        return pending_file.set_failed()

    @staticmethod
    async def delete_file(bucket: str, s3_file: str) -> bool:
        try:
            await GCSClients.get().delete(bucket, s3_file)
            return True
        except Exception as e:
            if not is_missing(e):
                logger.error(f"Failed to delete {s3_file} from Google Cloud Storage: {e}")
        return False

    @staticmethod
    async def check_file_exists(store_file: StoredFileSchema) -> bool:
        try:
            await GCSClients.get().download_metadata(store_file.bucket, store_file.s3_file_name)
            return True
        except Exception as e:
            if not is_missing(e):
                logger.error(f"Failed to look up {store_file.s3_file_name} in Google Cloud Storage: {e}")
        return False

    @staticmethod
    async def get_file(bucket: str, s3_file: str) -> None | BinaryIO | bytes:
        try:
            return await GCSClients.get().download(bucket, s3_file)
        except Exception as e:
            if not is_missing(e):
                logger.error(f"Failed to read {s3_file} from Google Cloud Storage: {e}")
        return None

    @staticmethod
    def get_stream(store_file: StoredFileSchema, **kwargs: Any) -> StreamingResponse:
        return GCSStream(store_file, **kwargs)
