import gzip
import json
from datetime import UTC, datetime  # type: ignore[attr-defined]
from uuid import UUID, uuid4

from pydantic import BaseModel, HttpUrl, ValidationError
from sqlalchemy import JSON, DateTime, LargeBinary, String, Text, TypeDecorator
from sqlalchemy.dialects.mysql import (
    DATETIME as MySQL_DATETIME,
    LONGBLOB,
    MEDIUMBLOB,
    MEDIUMTEXT,
)
from sqlalchemy.dialects.postgresql import BYTEA, JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy_utils import UUIDType

from api import base, crypto, database, schemas

Base = database.Base


class JSONType(TypeDecorator):
    impl = JSON
    cache_ok = True

    @classmethod
    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB)

        return dialect.type_descriptor(JSON)


class AwareDateTime(TypeDecorator):
    impl = DateTime
    cache_ok = True

    def process_result_value(self, value, _) -> None | datetime:  # noqa: PLR6301
        if isinstance(value, datetime):
            return value.replace(tzinfo=UTC)
        if value is None:
            return None
        raise ValueError(
            f"Object in datetime column must be datetime or none, instead value: {value} is of type: {type(value)}"
        )

    def process_bind_param(self, value, _):  # noqa: PLR6301
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        if value is None:
            return None
        raise ValueError(
            f"Object in datetime column must be datetime or none, instead value: {value} is of type: {type(value)}"
        )


class DATETIME(TypeDecorator):
    impl = DateTime
    cache_ok = True

    fsp: int | None = None
    timezone: bool = False

    def __init__(self, timezone: bool = False, fsp: int | None = None):
        self.timezone = timezone
        self.fsp = fsp
        self.impl = (
            DateTime(timezone)
            .with_variant(MySQL_DATETIME(fsp=fsp), "mysql")
            .with_variant(TIMESTAMP(timezone, fsp), "postgresql")
        )

    def __repr__(self):
        params = {"timezone": self.timezone, "fsp": self.fsp}
        params_str = ", ".join(f"{k}={v}" for k, v in params.items() if v)
        return f"{self.__class__.__name__}({params_str})"


class HttpUrlType(TypeDecorator):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | HttpUrl | None, _):  # noqa: PLR6301
        if value is None:
            return None
        return str(value)

    def process_result_value(self, value: str | HttpUrl | None, _):  # noqa: PLR6301
        if value is None:
            return None

        return str(value)


def process_json_bind_param(value: None | dict | str) -> None | bytes:  # noqa: PLR6301
    if value is None:
        return None
    as_str = json.dumps(value) if isinstance(value, dict | list) else value
    return gzip.compress(as_str.encode("utf-8"))


def process_json_result_value(value: None | bytes) -> None | dict:  # noqa: PLR6301
    if value is None:
        return None
    try:
        decompressed = gzip.decompress(value).decode("utf-8")
    except (gzip.BadGzipFile, UnicodeDecodeError, EOFError):
        return None
    return json.loads(decompressed)


class GzipJsonType(TypeDecorator):
    impl = MEDIUMBLOB
    cache_ok = True

    def process_bind_param(self, value: None | dict | str, _):  # noqa: PLR6301
        return process_json_bind_param(value)

    def process_result_value(self, value: None | bytes, _):  # noqa: PLR6301
        return process_json_result_value(value)

    @classmethod
    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(BYTEA)
        if dialect.name == "sqlite":
            return dialect.type_descriptor(LargeBinary())

        return dialect.type_descriptor(MEDIUMBLOB)


class GzipJsonLongType(TypeDecorator):
    impl = LONGBLOB
    cache_ok = True

    @classmethod
    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(BYTEA)
        if dialect.name == "sqlite":
            return dialect.type_descriptor(LargeBinary())

        return dialect.type_descriptor(LONGBLOB)

    def process_bind_param(self, value: None | dict | str, _):  # noqa: PLR6301
        return process_json_bind_param(value)

    def process_result_value(self, value: None | bytes, _):  # noqa: PLR6301
        return process_json_result_value(value)


class GzipStringType(TypeDecorator):
    impl = MEDIUMBLOB
    cache_ok = True

    def process_bind_param(self, value: None | str, _):  # noqa: PLR6301
        if value is None:
            return None
        return gzip.compress(value.encode("utf-8"))

    def process_result_value(self, value: None | bytes, _):  # noqa: PLR6301
        if value is None:
            return None
        try:
            return gzip.decompress(value).decode("utf-8")
        except (gzip.BadGzipFile, UnicodeDecodeError, EOFError):
            return None

    @classmethod
    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(BYTEA)
        if dialect.name == "sqlite":
            return dialect.type_descriptor(LargeBinary())

        return dialect.type_descriptor(MEDIUMBLOB)


class _BoundToColumn(TypeDecorator):
    impl = Text
    cache_ok = True

    def __init__(self, context: str):
        super().__init__()
        self.context = context

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.context!r})"


class EncryptedType(_BoundToColumn):
    cache_ok = True

    def process_bind_param(self, value: None | dict | list, _):
        if value is None:
            return None
        if not isinstance(value, dict | list):
            raise ValueError("Object in EncryptedType column must be dict or list")
        return crypto.encrypt_json(value, self.context)

    def process_result_value(self, value: None | str, _):
        if value is None:
            return None
        return crypto.decrypt_json(value, self.context)


class EncryptedMediumType(EncryptedType):
    cache_ok = True

    def load_dialect_impl(self, dialect):  # noqa: PLR6301
        if dialect.name == "mysql":
            return dialect.type_descriptor(MEDIUMTEXT())
        return dialect.type_descriptor(Text())


class EncryptedStringType(_BoundToColumn):
    cache_ok = True

    def process_bind_param(self, value: None | str, _):
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Object in EncryptedStringType column must be a string")
        return crypto.encrypt_text(value, self.context)

    def process_result_value(self, value: None | str, _):
        if value is None:
            return None
        return crypto.decrypt_text(value, self.context)


class PasswordType(TypeDecorator):
    impl = String(128)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # noqa: PLR6301
        if value is None:
            return None
        if dialect.name == "mysql":
            return base.get_password_hash(value)
        elif dialect.name in {"postgresql", "sqlite"}:
            return base.get_password_hash(value).decode("utf-8")
        return value

    def process_result_value(self, value, dialect):  # noqa: PLR6301
        if value is None:
            return None
        if dialect.name == "mysql":
            return value
        elif dialect.name in {"postgresql", "sqlite"} and isinstance(value, str):
            return value.encode("utf-8")
        return value


class BasePydanticType(TypeDecorator):
    impl = JSON
    model: type[BaseModel]

    @classmethod
    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB)

        return dialect.type_descriptor(JSON)

    def process_bind_param(self, value, _):
        if value is None:
            return None
        if isinstance(value, self.model):
            return value.model_dump_json()
        raise ValueError(f"Object must be of type {self.name}")

    def process_result_value(self, value, _):
        if value is None:
            try:
                return self.model()
            except ValidationError:
                return self.model.default()
        if isinstance(value, dict):
            return self.model(**value)
        data_dict = json.loads(value)
        return self.model(**data_dict)


class UserDisplaySettingsType(BasePydanticType):
    model = schemas.UserDisplaySettings
    cache_ok = True
    name = "UserDisplaySettings"


class UUIDMixin:
    uuid: Mapped[UUID] = mapped_column(UUIDType, primary_key=True, default=uuid4)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, self.__class__):
            return False
        return self.uuid == other.uuid

    def __hash__(self):
        return hash(self.uuid)


class DateMixin:
    created_date: Mapped[None | datetime] = mapped_column(
        AwareDateTime(), default=base.get_now
    )
    updated_date: Mapped[None | datetime] = mapped_column(
        AwareDateTime(), default=base.get_now, onupdate=base.get_now
    )
