import json
import os
import re
import ssl
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path
from ssl import SSLContext
from typing import Any, Literal, TypeVar, overload
from uuid import UUID

import aioboto3
import boto3
from aiobotocore.config import AioConfig
from aiobotocore.session import AioSession
from azure.identity import DefaultAzureCredential
from azure.storage.blob.aio import BlobClient
from botocore.client import BaseClient, Config
from fastapi.encoders import jsonable_encoder
from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis import Redis
from redis.asyncio import Redis as AsyncRedis
from redis.asyncio.cluster import RedisCluster as AsyncRedisCluster
from redis.cluster import RedisCluster
from sqlalchemy import AsyncAdaptedQueuePool
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api.crypto import decode_key_material

_RedisCacheT = TypeVar("_RedisCacheT")

MIN_SECRET_BYTES = 32
PROMETHEUS_LISTENER_PORT = 6970
RQ_QUEUE_NAME = "payments_queue"
CORS_ORIGIN = re.compile(r"https?://[A-Za-z0-9.-]+(:\d{1,5})?|https?://\[[0-9A-Fa-f:.]+\](:\d{1,5})?")


def check_origins(name: str, origins: list[str]) -> list[str]:
    for origin in origins:
        if not CORS_ORIGIN.fullmatch(origin):
            raise ValueError(
                f"{name}: {origin!r} is not an origin; give the scheme, host and port "
                "only, as http(s)://host[:port], with no path and no *"
            )
    return origins


def check_strong_secret(name: str, value: str) -> str:
    if len(value.encode("utf-8")) < MIN_SECRET_BYTES:
        raise ValueError(
            f"{name} must be at least {MIN_SECRET_BYTES} bytes; generate one with "
            'python -c "import secrets; print(secrets.token_urlsafe(32))"'
        )
    return value


def create_path(*path: str) -> str:
    base_path = os.path.dirname(os.path.abspath(__file__))
    in_between = os.path.dirname(base_path)
    default_path = os.path.join(in_between, *path)
    return default_path


def get_url(self: "DatabaseSettings", access: Literal["READ", "WRITE"] = "READ") -> str:
    if self.DATABASE_TYPE == "sqlite":
        return f"sqlite:///{self.DB_PATH}"

    user = getattr(self, f"{access}_DB_USER")
    password = getattr(self, f"{access}_DB_PASSWORD")
    the_host = self.DB_HOST
    the_port = self.DB_PORT
    name = self.DB_NAME

    if self.DATABASE_TYPE == "postgresql":
        return f"postgresql+pg8000://{user}:{password}@{the_host}:{the_port}/{name}"

    return f"mysql+pymysql://{user}:{password}@{the_host}:{the_port}/{name}?charset=utf8mb4"


class DatabaseConnectArgs(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    ssl: SSLContext | None = None


DB_POOL_SIZE = {
    "mysql": {"max": 150, "default": 50, "overflow": 20},
    "postgresql": {"max": 100, "default": 50, "overflow": 10},
    "sqlite": {"max": 1, "default": 1, "overflow": 0},
}


class DatabaseEngineSettings(BaseModel):
    pool_pre_ping: bool = True
    pool_size: int = 50
    max_overflow: int = 20
    pool_timeout: int = 30
    pool_recycle: int = 1800
    echo: bool = False
    connect_args: DatabaseConnectArgs = DatabaseConnectArgs()

    @model_validator(mode="after")
    def _adjust_pool_size(self):
        limits = DB_POOL_SIZE[settings.DATABASE_TYPE]
        self.pool_size = limits["default"]
        self.max_overflow = limits["overflow"]

        total_connections_per_worker = limits["default"] + limits["overflow"]
        if settings.WORKERS * total_connections_per_worker > limits["max"]:
            scale_factor = limits["max"] / (
                settings.WORKERS * total_connections_per_worker
            )
            self.pool_size = max(1, int(self.pool_size * scale_factor))
            self.max_overflow = max(0, int(self.max_overflow * scale_factor))

        return self

    @classmethod
    def with_custom_ssl(cls, ssl_context: SSLContext | None = None):
        connect_args = DatabaseConnectArgs(ssl=ssl_context)
        return cls(connect_args=connect_args)


class DatabaseSessionManager:
    def __init__(self, host: str, **engine_kwargs: Any):
        host = host.replace("pymysql", "aiomysql").replace("pg8000", "asyncpg")

        is_sqlite = host.startswith("sqlite")
        if is_sqlite:
            host = host.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
            engine_kwargs["pool_size"] = 1
            engine_kwargs["max_overflow"] = 0
            engine_kwargs["connect_args"] = {"check_same_thread": False, "timeout": 5}

        self._engine = create_async_engine(
            host, **engine_kwargs, poolclass=AsyncAdaptedQueuePool
        )
        self._sessionmaker = async_sessionmaker(
            self._engine, expire_on_commit=False, autocommit=False, autoflush=True
        )

    async def close(self):
        if self._engine is None:
            raise Exception("DatabaseSessionManager is not initialized")
        await self._engine.dispose()

        self._engine = None
        self._sessionmaker = None

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession]:
        if self._sessionmaker is None:
            raise Exception("DatabaseSessionManager is not initialized")

        session = self._sessionmaker()
        try:
            yield session
        except Exception as e:
            await session.rollback()
            raise e
        finally:
            await session.close()


class DatabaseSettings(BaseModel):
    READ_DB_USER: str | None = Field(
        None,
        description=(
            "The database account for queries that only read. It may be the same account as WRITE_DB_USER. Required with "
            "DATABASE_TYPE mysql or postgresql."
        ),
    )
    READ_DB_PASSWORD: str | None = Field(
        None,
        description="The password of READ_DB_USER. Required with DATABASE_TYPE mysql or postgresql.",
    )
    WRITE_DB_USER: str | None = Field(
        None,
        description=(
            "The database account for queries that write, and for the migrations that run when the API starts. Required "
            "with DATABASE_TYPE mysql or postgresql."
        ),
    )
    WRITE_DB_PASSWORD: str | None = Field(
        None,
        description="The password of WRITE_DB_USER. Required with DATABASE_TYPE mysql or postgresql.",
    )
    DB_HOST: str | None = Field(
        None,
        description=(
            "The host name of the database server. Required with DATABASE_TYPE mysql or postgresql. Outside Docker, for "
            "example with docker-compose-local-dev.yml, use localhost."
        ),
    )
    DB_NAME: str | None = Field(
        None,
        description="The name of the database on the server. Required with DATABASE_TYPE mysql or postgresql.",
    )
    DB_PORT: int | None = Field(
        None,
        description="The port of the database server. Required with DATABASE_TYPE mysql or postgresql.",
    )
    DB_PATH: str = Field(
        "local.db",
        description="The path of the SQLite database file. It is used only with DATABASE_TYPE sqlite.",
    )
    DATABASE_TYPE: Literal["mysql", "postgresql", "sqlite"] = Field(
        "mysql",
        description="The kind of database that the API uses. With sqlite the API needs only DB_PATH.",
    )
    SSL_CA: str | None = Field(
        None,
        description=(
            "The path of the certificate authority file with which the API verifies the database server's certificate. "
            "Setting SSL_CA, SSL_CERT or SSL_KEY makes the connection to the database use TLS."
        ),
    )
    SSL_CERT: str | None = Field(
        None,
        description=(
            "The path of the client certificate that the API presents to the database. It must be set together with "
            "SSL_KEY."
        ),
    )
    SSL_KEY: str | None = Field(
        None,
        description="The path of the private key of SSL_CERT. It must be set together with SSL_CERT.",
    )

    @model_validator(mode="after")
    def _validate_db_settings(self):
        if self.DATABASE_TYPE == "sqlite":
            return self
        required = [
            "READ_DB_USER",
            "READ_DB_PASSWORD",
            "WRITE_DB_USER",
            "WRITE_DB_PASSWORD",
            "DB_HOST",
            "DB_NAME",
            "DB_PORT",
        ]
        missing = [f for f in required if getattr(self, f) is None]
        if missing:
            msg = (
                f"Fields {missing} are required when DATABASE_TYPE={self.DATABASE_TYPE}"
            )
            raise ValueError(msg)
        return self

    def get_ssl_config(self) -> SSLContext | None:
        if not (self.SSL_CA or self.SSL_CERT or self.SSL_KEY):
            return None
        if bool(self.SSL_CERT) != bool(self.SSL_KEY):
            raise ValueError("SSL_CERT and SSL_KEY must be set together (or neither)")
        ctx = ssl.create_default_context(cafile=self.SSL_CA)
        if self.SSL_CERT and self.SSL_KEY:
            ctx.load_cert_chain(certfile=self.SSL_CERT, keyfile=self.SSL_KEY)
        return ctx

    def get_read_url(self) -> str:
        return get_url(self)

    def get_read_session(
        self, settings: DatabaseEngineSettings | None = None
    ) -> DatabaseSessionManager:
        if settings is None:
            settings = DatabaseEngineSettings.with_custom_ssl(self.get_ssl_config())
        return DatabaseSessionManager(self.get_read_url(), **settings.model_dump())

    def get_write_url(self) -> str:
        return get_url(self, access="WRITE")

    def get_write_session(
        self, settings: DatabaseEngineSettings | None = None
    ) -> DatabaseSessionManager:
        if settings is None:
            settings = DatabaseEngineSettings.with_custom_ssl(self.get_ssl_config())
        return DatabaseSessionManager(self.get_write_url(), **settings.model_dump())


class RedisSettings(BaseModel):
    REDIS_HOST: str = Field(
        "valkey",
        description=(
            "The host name of the Redis or Valkey server. Outside Docker, for example with docker-compose-local-dev.yml, "
            "use localhost."
        ),
    )
    REDIS_USER: str | None = Field(
        "",
        description="The user name for the Redis server. Leave it empty when the server has no users.",
    )
    REDIS_PASS: str = Field(
        description=(
            "The password of the Redis server. It may be empty when the server has no password, but the variable must be "
            "set."
        ),
    )
    REDIS_PORT: int = Field(6379, description="The port of the Redis server when the connection does not use TLS.")
    REDIS_SSL_PORT: int = Field(
        6380,
        description=(
            "The port of the Redis server when the connection uses TLS, which is the case when REDIS_SSL_CA, "
            "REDIS_SSL_CERT or REDIS_SSL_KEY is set, or REDIS_SSL_CERT_REQ is none."
        ),
    )
    REDIS_DB_BOT: int = Field(
        0,
        description=(
            "The number of the Redis database that holds the job queues and the workers of RQ. It is ignored in cluster "
            "mode."
        ),
    )
    REDIS_DB_APP: int = Field(
        1,
        description=(
            "The number of the Redis database that holds what the API keeps for a short time: agent tokens, password "
            "reset links, sign-in nonces, MCP sign-in state, usage counts, pending uploads, signed file links, the rate "
            "limits and the migration lock. It is ignored in cluster mode."
        ),
    )
    REDIS_SSL_CA: str | None = Field(
        None,
        description=(
            "The path of the certificate authority file that verifies the Redis server's certificate. Setting it turns "
            "on TLS."
        ),
    )
    REDIS_SSL_CERT: str | None = Field(
        None,
        description=(
            "The path of a certificate bundle that the API trusts for the Redis server; REDIS_SSL_CA takes its place "
            "when this is unset. Setting it turns on TLS."
        ),
    )
    REDIS_SSL_KEY: str | None = Field(
        None,
        description="The path of the private key file for the TLS connection to Redis.",
    )
    REDIS_SSL_CERT_REQ: Literal["none", "optional", "required"] | None = Field(
        None,
        description=(
            "Whether the API demands a valid certificate from the Redis server. With none, the connection uses TLS "
            "without verifying the certificate."
        ),
    )
    REDIS_CLUSTER_MODE: bool = Field(
        False,
        description=(
            "With true, the API talks to a Redis Cluster instead of a single server. The values 1 and true turn it on, "
            "and 0 and false turn it off."
        ),
    )
    REDIS_RQ_HASH_TAGS: bool = Field(
        False,
        description=(
            "With true, the job queues of RQ use hash tags in their keys, so that they work on a sharded Redis that does "
            "not expose cluster endpoints."
        ),
    )

    __port: int | None = None
    __schema: str | None = None
    __ssl_config: dict[str, Any] | None = None

    def __init__(self, **data: Any):
        super().__init__(**data)

        ssl_config = self.get_redis_ssl_config()
        self.__ssl_config = ssl_config
        self.__port = self.REDIS_SSL_PORT if ssl_config else self.REDIS_PORT
        self.__schema = "rediss" if ssl_config else "redis"

    @property
    def schema(self) -> str:
        return self.__schema

    @property
    def ssl_config(self) -> dict[str, Any] | None:
        return self.__ssl_config

    @property
    def port(self) -> int:
        return self.__port

    def get_redis_ssl_config(self) -> dict[str, Any] | None:
        ssl_config = {}
        if self.REDIS_SSL_CERT or self.REDIS_SSL_CA:
            ssl_certfile = self.REDIS_SSL_CERT or self.REDIS_SSL_CA
            ssl_config["ssl_ca_certs"] = ssl_certfile
        if self.REDIS_SSL_KEY:
            ssl_config["ssl_keyfile"] = self.REDIS_SSL_KEY

        update = {"ssl": True, "ssl_cert_reqs": self.REDIS_SSL_CERT_REQ}
        if ssl_config or self.REDIS_SSL_CERT_REQ == "none":
            ssl_config.update(update)
            return ssl_config
        return None

    def get_redis_url(self) -> str:
        uri = f"{self.schema}://{self.REDIS_USER}:{self.REDIS_PASS}@{self.REDIS_HOST}:{self.port}/{self.REDIS_DB_APP}"

        if self.REDIS_CLUSTER_MODE:
            uri = uri.replace(f"/{self.REDIS_DB_APP}", "")

        query_params = []
        if self.ssl_config:
            for key in ["ssl_ca_certs", "ssl_cert_reqs", "ssl_keyfile"]:
                if key in self.ssl_config:
                    query_params.append(f"{key}={self.ssl_config[key]}")

        if query_params:
            uri += "?" + "&".join(query_params)

        return uri

    def get_redis_session(
        self, database: Literal["bot", "app"]
    ) -> Redis | RedisCluster:
        db_options = {
            "bot": self.REDIS_DB_BOT,
            "app": self.REDIS_DB_APP,
        }

        kwargs = {
            "host": self.REDIS_HOST,
            "username": self.REDIS_USER,
            "password": self.REDIS_PASS,
            "port": self.port,
        }

        if self.ssl_config:
            kwargs.update(self.ssl_config)

        if self.REDIS_CLUSTER_MODE:
            return RedisCluster(**kwargs)

        kwargs["db"] = db_options[database]
        return Redis(**kwargs)

    def get_async_redis_session(
        self, database: Literal["app"]
    ) -> AsyncRedis | AsyncRedisCluster:
        db_options = {
            "app": self.REDIS_DB_APP,
        }

        kwargs = {
            "host": self.REDIS_HOST,
            "username": self.REDIS_USER,
            "password": self.REDIS_PASS,
            "port": self.port,
        }

        if self.ssl_config:
            kwargs.update(self.ssl_config)

        if self.REDIS_CLUSTER_MODE:
            return AsyncRedisCluster(**kwargs)

        kwargs["db"] = db_options[database]
        return AsyncRedis(**kwargs)

    @overload
    def redis_cache(
        self,
        redis_key: str | UUID,
        data: None = ...,
        expire: int | timedelta | None = ...,
        update: bool = ...,
        delete: bool = ...,
    ) -> bool: ...

    @overload
    def redis_cache(
        self,
        redis_key: str | UUID,
        data: "_RedisCacheT",
        expire: int | timedelta | None = ...,
        update: bool = ...,
        delete: bool = ...,
    ) -> "_RedisCacheT": ...

    def redis_cache(
        self,
        redis_key: str | UUID,
        data: "_RedisCacheT | None" = None,
        expire: int | timedelta | None = None,
        update: bool = False,
        delete: bool = False,
    ) -> "_RedisCacheT":
        if not isinstance(expire, timedelta) and expire is not None:
            expire = timedelta(seconds=expire)

        redis_client = self.get_redis_session("app")
        redis_key = str(redis_key)

        if self.REDIS_CLUSTER_MODE:
            redis_key = f"app:{{cluster}}:{redis_key}"

        if redis_client.get(redis_key) and not update:
            if delete:
                redis_client.delete(redis_key)
                return True

            return json.loads(redis_client.get(redis_key))

        if data is None:
            return False

        redis_client.set(
            redis_key, json.dumps(jsonable_encoder(data)), ex=expire if expire else None
        )

        return data


class AWSSettings(BaseModel):
    S3_ACCESS_KEY: str = Field(
        os.environ.get("S3_ACCESS_KEY", ""),
        description=(
            "The access key for the S3 bucket. Used with STORAGE_PROVIDER aws. When it is empty, the client looks for "
            "credentials the way AWS clients do."
        ),
    )
    S3_SECRET_KEY: str = Field(
        os.environ.get("S3_SECRET_KEY", ""),
        description="The secret key for the S3 bucket. Used with STORAGE_PROVIDER aws.",
    )
    S3_BUCKET_NAME: str | None = Field(
        os.environ.get("S3_BUCKET_NAME"),
        description="The name of an S3 bucket. The API does not read it: uploaded files go to S3_FILE_BUCKET.",
    )
    S3_FILE_BUCKET: str | None = Field(
        os.environ.get("S3_BUCKET"),
        description=(
            "The S3 bucket that holds uploaded files. When it is unset, the API reads the variable S3_BUCKET instead. "
            "Used with STORAGE_PROVIDER aws."
        ),
    )
    S3_VERIFY_SSL: bool | None = Field(
        None,
        description=(
            "Whether the S3 client verifies the endpoint's TLS certificate. Unset leaves the client's default, which "
            "verifies; false turns verification off."
        ),
    )
    S3_ENDPOINT_URL: str | None = Field(
        None,
        description=(
            "The address of the S3 service, for an S3-compatible service other than AWS. Unset, the client uses AWS."
        ),
    )
    S3_REGION: str | None = Field(
        os.environ.get("S3_REGION", None),
        description="The AWS region of the bucket, for example us-east-1.",
    )
    S3_SIGNATURE_VERSION: Literal["s3v4", "v4"] = Field(
        os.environ.get("S3_SIGNATURE_VERSION", "s3v4"),
        description="The signature version of requests to S3.",
    )

    def async_s3_client(self):
        session = self.get_async_s3_session()
        botocore_config = AioConfig(
            max_pool_connections=20, signature_version=self.S3_SIGNATURE_VERSION
        )
        return session.client(
            "s3",
            config=botocore_config,
            region_name=self.S3_REGION,
            endpoint_url=self.S3_ENDPOINT_URL,
            verify=self.S3_VERIFY_SSL,
        )

    def get_s3_client(self) -> BaseClient:
        return boto3.client(
            "s3",
            aws_access_key_id=self.S3_ACCESS_KEY or None,
            aws_secret_access_key=self.S3_SECRET_KEY or None,
            region_name=self.S3_REGION,
            endpoint_url=self.S3_ENDPOINT_URL,
            verify=self.S3_VERIFY_SSL,
            config=Config(signature_version=self.S3_SIGNATURE_VERSION),
        )

    def get_async_s3_session(self) -> aioboto3.Session:
        return aioboto3.Session(
            aws_access_key_id=self.S3_ACCESS_KEY or None,
            aws_secret_access_key=self.S3_SECRET_KEY or None,
            region_name=self.S3_REGION,
        )

    async def s3_client(self):
        session = AioSession()
        botocore_config = AioConfig(
            max_pool_connections=20, signature_version=self.S3_SIGNATURE_VERSION
        )

        try:
            async with session.create_client(
                "s3",
                aws_access_key_id=self.S3_ACCESS_KEY or None,
                aws_secret_access_key=self.S3_SECRET_KEY or None,
                region_name=self.S3_REGION,
                endpoint_url=self.S3_ENDPOINT_URL,
                config=botocore_config,
                verify=self.S3_VERIFY_SSL,
            ) as client:
                yield client
        except Exception as e:
            raise e


class LocalStorageSettings(BaseModel):
    FOLDER_STORAGE_PATH: str = Field(
        os.environ.get("FOLDER_STORAGE_PATH", "local_storage"),
        description=(
            "The folder that holds uploaded files, relative to the API's working directory unless the path is absolute. "
            "Used with STORAGE_PROVIDER folder."
        ),
    )
    LOCAL_STORAGE_SECRET_KEY: str | None = Field(
        None,
        description=(
            "The secret that signs the temporary links to uploaded files. At least 32 bytes. Required with "
            "STORAGE_PROVIDER folder."
        ),
    )

    @field_validator("LOCAL_STORAGE_SECRET_KEY")
    @classmethod
    def check_storage_secret(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return check_strong_secret("LOCAL_STORAGE_SECRET_KEY", value)

    def get_local_file_path(self, s3_file: str) -> Path:
        path = Path(self.FOLDER_STORAGE_PATH) / s3_file
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def generate_signature(self, object_name: str, expiration: int) -> str:
        import hashlib  # noqa: E117, PLC0415
        import hmac  # noqa: E117, PLC0415

        secret_key = self.LOCAL_STORAGE_SECRET_KEY.encode()
        message = f"{object_name}:{expiration}".encode()
        signature = hmac.new(secret_key, message, hashlib.sha256).hexdigest()
        return signature

    def validate_signature(
        self, object_name: str, expiration: int, signature: str
    ) -> bool:
        import hmac  # noqa: E117, PLC0415

        expected_signature = self.generate_signature(object_name, expiration)
        if not hmac.compare_digest(expected_signature, signature):
            return False

        return datetime.now(UTC) < datetime.fromtimestamp(expiration, tz=UTC)


class AzureSettings(BaseModel):
    AZURE_CONNECTION_STRING: str | None = Field(
        None,
        description=(
            "The connection string of the Azure storage account. Used with STORAGE_PROVIDER azure, which needs it "
            "together with AZURE_STORAGE_ACCOUNT."
        ),
    )
    AZURE_STORAGE_CONTAINER: str | None = Field(
        os.environ.get("AZURE_STORAGE_CONTAINER"),
        description="The Azure blob container that holds uploaded files. Used with STORAGE_PROVIDER azure.",
    )
    AZURE_STORAGE_ACCOUNT: str | None = Field(
        None,
        description="The name of the Azure storage account. Used with STORAGE_PROVIDER azure.",
    )
    AZURE_USE_CLI_AUTH: bool | None = Field(
        None,
        description=(
            "With true, the API signs in to the Azure storage account with the credentials of its environment (the Azure "
            "default credential) instead of the connection string."
        ),
    )

    __token_credential: DefaultAzureCredential | None = None

    @property
    def token_credential(self) -> DefaultAzureCredential:
        if self.__token_credential is None:
            self.__token_credential = DefaultAzureCredential()
        return self.__token_credential

    def check_azure(self):
        if not all([self.AZURE_CONNECTION_STRING, self.AZURE_STORAGE_ACCOUNT]):
            raise Exception(
                "Azure connection string or storage account must be set in environment."
                " (`AZURE_CONNECTION_STRING`, `AZURE_STORAGE_ACCOUNT`)"
            )

    def azure_blob_client(self, blob: str, container: str) -> BlobClient:
        self.check_azure()

        if self.AZURE_USE_CLI_AUTH:
            return BlobClient(
                account_url=f"https://{self.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net",
                container_name=container,
                blob_name=blob,
                credential=self.token_credential,
            )

        return BlobClient.from_connection_string(
            self.AZURE_CONNECTION_STRING, container, blob
        )


class AccessSettings(BaseModel):
    WORKSPACE_AES_KEY: str = Field(
        description=(
            "The key of the encryption at rest (AES-256-GCM), as a base64url string of at least 32 bytes: stored "
            "provider keys, connection and MCP headers and authenticator secrets are encrypted with it. The API does not "
            "start without it, and what is stored under it cannot be read with another key."
        ),
    )

    @field_validator("WORKSPACE_AES_KEY")
    @classmethod
    def check_aes_key(cls, value: str) -> str:
        decode_key_material(value)
        return value


class PrometheusSettings(BaseModel):
    PROMETHEUS: bool | None = Field(
        False,
        description=(
            "With true, the API serves its Prometheus metrics at /metrics, the first worker also serves them on port "
            f"{PROMETHEUS_LISTENER_PORT}, and the API samples its event loop, thread pool and database pools."
        ),
    )
    RUNTIME_METRICS_INTERVAL: float = Field(
        2.0,
        description=(
            "The number of seconds between the samples of the event loop, the thread pool and the database pools that "
            "PROMETHEUS turns on."
        ),
    )


class NotificationSettings(BaseModel):
    ADMIN_NOTIFIER: str = Field(
        "api.notifications:WebhookNotifier",
        description=(
            "The transport of admin notifications (new entities), as an import path package.module:Class. The default "
            "posts JSON to ADMIN_NOTIFY_WEBHOOK_URL."
        ),
    )
    ADMIN_NOTIFY_WEBHOOK_URL: str | None = Field(
        None,
        description=(
            "The address that the default notifier posts to. Unset, the API logs notifications instead of sending them."
        ),
    )
    ADMIN_NOTIFY_WEBHOOK_SECRET: str | None = Field(
        None,
        description=(
            "The secret of the X-Admin-Notification-Signature header, an HMAC-SHA256 of the body. Without it, the "
            "notifier sends no signature."
        ),
    )
    ADMIN_NOTIFY_RECIPIENT: str | None = Field(
        None,
        description=(
            "The recipient that the notification payload names, for example an email address. The transport decides what "
            "to do with it."
        ),
    )
    ADMIN_NOTIFY_SENDER: str | None = Field(
        None,
        description=(
            "The sender that the notification payload names, for example an email address. The transport decides what to "
            "do with it."
        ),
    )


class AppSettings(BaseModel):
    DEFAULT_USER_MAPPING: UUID | None = Field(
        None,
        description=(
            "The id of the permissions mapping that a user gets when they first sign in. The file user_create.json, "
            "which the init step of the deployment writes, overrides it with the id that it holds."
        ),
    )
    APPURL: str = Field(
        description=(
            "The address of the Workspace web app, which the API uses for login redirects and for the password reset "
            "links that an administrator gives to users."
        ),
    )

    def __init__(self, **data: Any):
        super().__init__(**data)

        if not (create_user := Path.cwd() / "user_create.json").exists():
            return

        with suppress(Exception):
            json_data = json.loads(create_user.read_text())
            self.DEFAULT_USER_MAPPING = UUID(json_data["permissions_uuid"])


class DefaultMCPServer(BaseModel):
    id: str
    name: str
    url: str


class GeneralSettings(BaseModel):
    JWT_SECRET: str = Field(
        description=(
            "The secret that signs the service tokens, including the metering token of the agent. At least 32 bytes, and "
            "the API does not start without it. Changing it invalidates every token that it signed."
        ),
    )
    IS_WORKER_CONTAINER: bool = Field(
        False,
        description=(
            "True in the process that runs the RQ worker. The worker's entry point sets it itself; a Redis Cluster "
            "compatibility patch of RQ is applied only when it is false."
        ),
    )
    DISABLE_REGISTRATION: bool = Field(
        False,
        description=(
            'With true, every path that creates a user answers 403 "Registration is disabled": POST /admin/register, '
            "POST /entity/register-admin, sharing with someone who has no account, and the first sign-in of a new user "
            "through an identity provider. Existing users can still sign in. Read once at startup."
        ),
    )

    FRONTENDURL: str = Field(
        description="The address of the web app's front end. The API requires it but does not read it.",
    )
    SELFURL: str = Field(
        description=(
            "The address at which clients reach this API. It forms the links to uploaded files, and an address that "
            "starts with https:// marks the deployment as HTTPS, so that the Workspace MCP hands out only https:// "
            "addresses."
        ),
    )
    MODE: Literal["production", "local", "test"] = Field(
        description=(
            "The mode of the deployment. With test, the API keeps its rate limits and the state of the Workspace MCP in "
            "its own process instead of Redis; production and local behave alike."
        ),
    )
    RATE_LIMIT_EXEMPT_ENABLED: bool = Field(
        False,
        description=(
            "With true, a request that carries a valid service token in the header X-Workspace-Authorization skips the "
            "rate limits. For development only."
        ),
    )
    GOOGLE_OAUTH_CLIENT_ID: str | None = Field(
        None,
        description=(
            "The OAuth client id of the Google sign-in, the same value as the web app's. The API accepts a Google token "
            "only when it was issued to this client; unset, every Google sign-in is refused."
        ),
    )
    AZURE_CLIENT_ID: str | None = Field(
        None,
        description=(
            "The application (client) id of the Microsoft Entra app registration, the same value as the web app's. The "
            "API accepts a Microsoft token only when it was issued to this client. The registration must send the "
            "optional ID token claims email and xms_edov, because without them a Microsoft sign-in by email is refused."
        ),
    )
    AZURE_TENANT_ID: str | None = Field(
        None,
        description=(
            "The tenant whose users may sign in: its id or domain, organizations (every work or school tenant) or common "
            "(those and personal Microsoft accounts), as in the authority of the web app."
        ),
    )
    OKTA_CLIENT_ID: str | None = Field(
        None,
        description=(
            "The client id of the Okta application, the same value as the web app's. The API accepts an Okta token only "
            "when it was issued to this client."
        ),
    )
    OKTA_DOMAIN: str | None = Field(
        None,
        description=(
            "The Okta issuer, exactly the web app's VITE_OKTA_DOMAIN, for example https://example.okta.com or "
            "https://example.okta.com/oauth2/default."
        ),
    )
    MAX_DICT_LEN: int = Field(
        100_000,
        description=(
            "The longest request body, counted in characters of its text, that a user's profile update may have. Longer "
            "ones are refused with 400."
        ),
    )
    WORKERS: int = Field(
        3,
        description=(
            "The number of worker processes that serve requests. The pools of database connections are sized so that all "
            "workers together stay under the limit of the database type."
        ),
    )
    WORKER_ADDRESS_SPACE_LIMIT_GB: float | None = Field(
        None,
        description=(
            "The most address space, in gigabytes, that each worker process may use. Unset, the limit is 75% of the "
            "container's memory limit, and none when there is no limit. A value of 0 or less turns the limit off."
        ),
    )
    PORT: int = Field(8000, description="The port on which the API listens, on every interface.")
    LOGURU_COLORIZE: bool = Field(True, description="Whether the log lines use colors.")
    JSON_LOGS: bool = Field(False, description="With true, each log line is a JSON object.")
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        "INFO",
        description="The least severe level that is logged, written in capitals.",
    )
    RQ_TIMEOUT: int = Field(
        10,
        description=(
            "The number of seconds that a job that the API puts on the RQ queue may run before the worker stops it."
        ),
    )
    CLEAR_UNCONFIRMED_FILES_DATE: str = Field(
        "2024-10-07",
        description=(
            "A date, written YYYY-MM-DD. On the day of the month that it names, the API queues at startup a one-off "
            "clean-up of uploaded files that were never confirmed, under job names that carry the date, so that each "
            "date runs once; a new date runs it again."
        ),
    )
    WORKSPACE_AUTH_TOKEN: str | None = Field(
        None,
        description=(
            "The deployment's service token, a JWT signed with JWT_SECRET. A request that carries a valid service token "
            "in X-Workspace-Authorization skips rate limits when RATE_LIMIT_EXEMPT_ENABLED is on. The API checks the "
            "signature of the token it receives; it does not read this variable, which is kept for the clients that send "
            "the token."
        ),
    )
    BACKEND_CORS_ORIGINS: list[str] | str = Field(
        description=(
            "The origins of the web app, exactly as browsers send them: scheme, host and port, without a path and "
            "without *. A comma-separated list or a JSON list. Required. The session cookie is accepted only from these "
            "origins, and browsers send it only when the API is on the same site as the page, so serve the API under the "
            "web app's registrable domain, and over HTTPS outside localhost."
        ),
    )
    BACKEND_CORS_ORIGIN_REGEX: str | None = Field(
        None,
        description=(
            "A regular expression that a whole origin may match instead of being listed in BACKEND_CORS_ORIGINS. It "
            "applies to the CORS headers and to the check of the Origin header."
        ),
    )
    SPECIAL_EMAILS: set[EmailStr] = Field(
        default_factory=set,
        description=(
            "Email addresses, as a JSON list, that are exempt from the check that an address has no account yet, so that "
            "more than one account may use them."
        ),
    )
    SUPPRESSED_API_ROUTERS: list[str] | None = Field(
        default_factory=list,
        description=(
            "The tags of the routers that the API does not mount, as a JSON list. The tags are the ones that the API "
            "logs at startup as the included routers; requests to the paths of a suppressed router answer 404."
        ),
    )
    SUPPRESSED_API_ROUTES: list[str] | None = Field(
        default_factory=list,
        description=(
            "The paths of single routes that the API removes after it mounts the routers, as a JSON list, for example "
            '["/app/files/{file}"].'
        ),
    )
    STORAGE_PROVIDER: Literal["aws", "azure", "gcp", "folder"] = Field(
        "folder",
        description=(
            "Where uploaded files are kept. folder keeps them in FOLDER_STORAGE_PATH, aws in the S3 bucket "
            "S3_FILE_BUCKET, azure in the container AZURE_STORAGE_CONTAINER and gcp in the bucket GCP_STORAGE_BUCKET."
        ),
    )
    GCP_STORAGE_BUCKET: str | None = Field(
        None,
        description="The Google Cloud Storage bucket that holds uploaded files. Used with STORAGE_PROVIDER gcp.",
    )
    ALLOWED_MCP_HOSTNAMES: list[str] = Field(
        default_factory=list,
        description=(
            "MCP servers on a private network, by host name exactly as their URLs name them, as a JSON list. The API "
            "reaches the MCP servers of users only at public internet addresses, so a server whose name resolves to a "
            "private, loopback or link-local address, such as an internal host or a Compose service, must be listed. The "
            "servers of DEFAULT_MCP_SERVERS need not be."
        ),
    )
    DEFAULT_MCP_SERVERS: list[DefaultMCPServer] = Field(
        default_factory=list,
        description=(
            "MCP servers that every user has, as a JSON list of objects with id, name and url. The API reaches their "
            "host and port as they are, even on a private network, and the default roles give access to all their tools."
        ),
    )

    @field_validator("JWT_SECRET")
    @classmethod
    def check_jwt_secret(cls, value: str) -> str:
        return check_strong_secret("JWT_SECRET", value)

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]

        if isinstance(v, str):
            return json.loads(v)
        return v

    @field_validator("BACKEND_CORS_ORIGINS")
    @classmethod
    def check_cors_origins(cls, origins: list[str]) -> list[str]:
        if not origins:
            raise ValueError(
                "BACKEND_CORS_ORIGINS must name the origins of the web app, "
                'e.g. ["http://localhost:3000"]'
            )
        return check_origins("BACKEND_CORS_ORIGINS", origins)

    def is_test(self) -> bool:
        return self.MODE == "test"

    def set_is_worker(self, is_worker: bool) -> None:
        self.IS_WORKER_CONTAINER = is_worker


class WidgetPluginSettings(BaseModel):
    WIDGET_PLUGINS_DIR: str | None = Field(
        None,
        description=(
            "The directory, inside the API container, that holds the widget plugin packages as <plugin-id>/<version>/. "
            "Unset, the plugin feature is off. Mount it read-only: the API only reads it, and nothing in the app "
            "installs or uploads plugins. Every API replica must see the same files."
        ),
    )
    WIDGET_PLUGINS_PINS: dict[str, str] = Field(
        default_factory=dict,
        description=(
            'The digests that the API expects of plugin versions, as a JSON object from "<plugin-id>@<version>" to '
            '"sha256-..."; `python -m scripts.plugin_check <plugin-id>/<version> --digest` prints one. A discovered '
            "version whose digest differs is blocked."
        ),
    )
    WIDGET_PLUGINS_REQUIRE_PINS: bool = Field(
        False,
        description=(
            "With true, the API blocks every plugin version that has no pin in WIDGET_PLUGINS_PINS. Recommended in "
            "production."
        ),
    )
    WIDGET_PLUGINS_MAX_UNPACKED_BYTES: int = Field(
        64 * 1024 * 1024,
        description=(
            "The most bytes, in total, that the files of one plugin version may have. A version over the limit is "
            "blocked."
        ),
    )
    WIDGET_PLUGINS_MAX_FILES: int = Field(
        200,
        description="The most files that one plugin version may have. A version over the limit is blocked.",
    )
    WIDGET_PLUGIN_SECRETS_DIR: str | None = Field(
        None,
        description=(
            "The directory that holds the values of the secrets which plugins declare for their proxies, one file per "
            "secret at <dir>/<plugin-id>/<secret-name>; a mounted Docker or Kubernetes secret works. A value found here "
            "wins over one that a superuser enters in the admin area, and makes that field read-only. Mount it "
            "read-only."
        ),
    )
    WIDGET_PLUGIN_PROXY_MAX_BYTES: int = Field(
        5 * 1024 * 1024,
        description=(
            "The most bytes that a response to a plugin proxy call may have, whatever the plugin's manifest declares."
        ),
    )
    WIDGET_PLUGIN_PROXY_TIMEOUT_MS: int = Field(
        30_000,
        description=(
            "The longest time, in milliseconds, that a plugin proxy call may take, whatever the plugin's manifest "
            "declares."
        ),
    )
    WIDGET_PLUGIN_PROXY_CONCURRENCY: int = Field(
        8,
        description="How many proxy calls of one plugin may run at once in each API process.",
    )
    WIDGET_PLUGIN_PROXY_RATE_PER_USER: str = Field(
        "60/minute",
        description=(
            "The rate limit of the proxy calls that one user may make, written <number>/<second|minute|hour|day>."
        ),
    )
    WIDGET_PLUGIN_PROXY_RATE_PER_PLUGIN: str = Field(
        "600/minute",
        description=(
            "The rate limit of the proxy calls that one plugin may receive from all users together, written "
            "<number>/<second|minute|hour|day>."
        ),
    )
    WIDGET_PLUGIN_PROXY_CA_FILE: str | None = Field(
        None,
        description=(
            "The path of a certificate authority file that the proxies trust besides the system's, for upstreams whose "
            "certificates a private authority signs."
        ),
    )
    WIDGET_PLUGIN_BACKENDS: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "The plugin backends that you run, as a JSON object from a plugin id to the internal address of its backend: "
            "http(s) on the private network, or unix:<socket path>. Each backend is built from a package's backend/ "
            "directory and runs as its own restricted container. The API calls a backend only while it reports the "
            "digest of the approved version."
        ),
    )
    WIDGET_PLUGIN_BACKEND_MAX_BYTES: int = Field(
        5 * 1024 * 1024,
        description=(
            "The most bytes that a response of a plugin backend may have, whatever the plugin's manifest declares."
        ),
    )
    WIDGET_PLUGIN_BACKEND_TIMEOUT_MS: int = Field(
        30_000,
        description=(
            "The longest time, in milliseconds, that a call to a plugin backend may take, whatever the plugin's manifest "
            "declares."
        ),
    )
    WIDGET_PLUGIN_BACKEND_CONCURRENCY: int = Field(
        8,
        description="How many calls to the backend of one plugin may run at once in each API process.",
    )
    WIDGET_PLUGIN_BACKEND_RATE_PER_USER: str = Field(
        "60/minute",
        description=(
            "The rate limit of the backend calls that one user may make, written <number>/<second|minute|hour|day>."
        ),
    )
    WIDGET_PLUGIN_BACKEND_RATE_PER_PLUGIN: str = Field(
        "600/minute",
        description=(
            "The rate limit of the calls that one plugin backend may receive from all users together, written "
            "<number>/<second|minute|hour|day>."
        ),
    )
    WIDGET_PLUGIN_BACKEND_BREAKER_FAILURES: int = Field(
        5,
        description=(
            "How many calls to a plugin backend must fail in a row before the API pauses its calls to that backend."
        ),
    )
    WIDGET_PLUGIN_BACKEND_BREAKER_SECONDS: int = Field(
        30,
        description="How many seconds the API pauses its calls to a plugin backend after too many failures in a row.",
    )
    WIDGET_PLUGIN_BACKEND_IDENTITY_SECONDS: int = Field(
        60,
        description=(
            "How many seconds the API trusts the answer of a plugin backend to its identity check before it asks again."
        ),
    )


class Settings(
    BaseSettings,
    WidgetPluginSettings,
    AccessSettings,
    GeneralSettings,
    AppSettings,
    DatabaseSettings,
    RedisSettings,
    AWSSettings,
    AzureSettings,
    LocalStorageSettings,
    PrometheusSettings,
    NotificationSettings,
):
    model_config = SettingsConfigDict(
        env_file=create_path("envs", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def check_folder_storage_secret(self) -> "Settings":
        if self.STORAGE_PROVIDER == "folder" and self.LOCAL_STORAGE_SECRET_KEY is None:
            raise ValueError("LOCAL_STORAGE_SECRET_KEY is required when STORAGE_PROVIDER=folder")
        return self

    def get_file_bucket(self) -> str | None:
        if self.STORAGE_PROVIDER == "aws":
            return self.S3_FILE_BUCKET

        if self.STORAGE_PROVIDER == "azure":
            return self.AZURE_STORAGE_CONTAINER

        if self.STORAGE_PROVIDER == "folder":
            return "local_storage"

        return self.GCP_STORAGE_BUCKET

    def setup_logging(self):
        from .log_helpers import setup_logging  # noqa: F401, PLC0415

        setup_logging(self)

    def is_https_deployment(self) -> bool:
        return self.SELFURL.startswith("https://")


settings = Settings()  # type: ignore[call-arg]
