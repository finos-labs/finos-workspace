from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy_utils import EmailType, UUIDType

from api import base
from api.models.entity_models import PermissionsEntityMap
from api.models.model_helpers import (
    AwareDateTime,
    Base,
    DateMixin,
    EncryptedStringType,
    GzipJsonType,
    GzipStringType,
    JSONType,
    PasswordType,
    UserDisplaySettingsType,
    UUIDMixin,
)


class User(Base, UUIDMixin, DateMixin):
    __tablename__ = "user"

    microsoft_id: Mapped[None | str] = mapped_column(String(100), default=None)
    first_name: Mapped[None | str] = mapped_column(String(100), default=None)
    last_name: Mapped[None | str] = mapped_column(String(100), default=None)
    email: Mapped[str] = mapped_column(EmailType, unique=True)
    clean_email: Mapped[str] = mapped_column(EmailType)
    username: Mapped[None | str] = mapped_column(String(50), unique=True)
    password: Mapped[str] = mapped_column(PasswordType, nullable=False)
    totp_secret: Mapped[None | str] = mapped_column(
        EncryptedStringType("user.totp_secret"), default=None
    )
    totp_last_step: Mapped[None | int] = mapped_column(BigInteger, default=None)
    totp_active: Mapped[bool] = mapped_column(Boolean, default=False)
    two_factor_auth: Mapped[bool] = mapped_column(Boolean, default=False)
    temporary_password: Mapped[None | bool] = mapped_column(Boolean, default=False)
    openai_api_key: Mapped[None | str] = mapped_column(
        EncryptedStringType("user.openai_api_key")
    )
    perplexity_api_key: Mapped[None | str] = mapped_column(
        EncryptedStringType("user.perplexity_api_key")
    )

    logins = relationship("Login", back_populates="user")

    display_settings = Column(UserDisplaySettingsType)

    referred_by = Column(String(100), default=None)
    referred_by_sent = Column(Boolean, default=False)
    referral_code = Column(
        String(100), unique=True, nullable=False, default=base.random_string
    )
    total_referrals: Mapped[None | int] = mapped_column(Integer, default=0)

    deleted = Column(Boolean, default=False)
    confirmed = Column(Boolean, default=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)

    permissions_uuid: Mapped[None | UUID] = mapped_column(
        ForeignKey("permissions_entity_map.uuid"), index=True
    )
    permissions: Mapped[Optional["PermissionsEntityMap"]] = relationship()
    app_start: Mapped[None | datetime] = mapped_column(AwareDateTime())
    latest_version: Mapped[None | str] = mapped_column(Text)

    def __str__(self) -> str:
        return str(self.email)


class Session(Base, UUIDMixin, DateMixin):
    __tablename__ = "session"

    token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    user_uuid: Mapped[None | UUID] = mapped_column(
        UUIDType, ForeignKey("user.uuid"), index=True
    )
    user = relationship("User")
    expiration_date: Mapped[None | datetime] = mapped_column(AwareDateTime())
    app_session: Mapped[bool] = mapped_column(Boolean, default=False)
    source = Column(String(20), default=None)


class ProviderSession(Base, UUIDMixin, DateMixin):
    __tablename__ = "provider_session"

    session_uuid: Mapped[UUID] = mapped_column(UUIDType, nullable=False, unique=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    id_token: Mapped[str] = mapped_column(
        EncryptedStringType("provider_session.id_token"), nullable=False
    )
    id_token_expires_at: Mapped[datetime] = mapped_column(AwareDateTime(), nullable=False)
    refresh_token: Mapped[str] = mapped_column(
        EncryptedStringType("provider_session.refresh_token"), nullable=False
    )


class SigningKey(Base, UUIDMixin, DateMixin):
    __tablename__ = "signing_key"

    private_key: Mapped[str] = mapped_column(
        EncryptedStringType("signing_key.private_key"), nullable=False
    )
    public_jwk: Mapped[dict] = mapped_column(JSONType, nullable=False)


class PersonalAccessToken(Base, UUIDMixin, DateMixin):
    __tablename__ = "personal_access_token"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_personal_access_token_token_hash"),
        Index(
            "ix_personal_access_token_user_uuid_token_type", "user_uuid", "token_type"
        ),
    )

    user_uuid: Mapped[UUID] = mapped_column(ForeignKey("user.uuid"), index=True)
    user: Mapped["User"] = relationship()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    token_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    token_prefix: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    revoked_at: Mapped[None | datetime] = mapped_column(AwareDateTime())
    last_used_at: Mapped[None | datetime] = mapped_column(AwareDateTime())


class Login(Base, UUIDMixin, DateMixin):
    __tablename__ = "login"

    user_uuid: Mapped[None | UUID] = mapped_column(
        UUIDType, ForeignKey("user.uuid"), index=True
    )
    user = relationship("User", back_populates="logins")
    source = Column(String(20), default=None)

    def __str__(self) -> str:
        return f"{self.user_uuid}-{self.created_date}"


class UserInvite(Base, UUIDMixin, DateMixin):
    __tablename__ = "user_invite"

    inviting_user_uuid: Mapped[None | UUID] = mapped_column(
        ForeignKey("user.uuid"), index=True
    )
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    email: Mapped[str] = mapped_column(EmailType)
    permissions_uuid: Mapped[None | UUID] = mapped_column(
        ForeignKey("permissions_entity_map.uuid", ondelete="SET NULL"),
    )
    data = Column(JSONType)


class UserPrompts(Base, UUIDMixin, DateMixin):
    __tablename__ = "user_prompts"

    user_uuid: Mapped[UUID] = mapped_column(ForeignKey("user.uuid"), index=True)
    prompt: Mapped[dict | list[dict] | None] = mapped_column(
        GzipJsonType,
    )


class UserSkills(Base, UUIDMixin, DateMixin):
    __tablename__ = "user_skills"
    __table_args__ = (
        UniqueConstraint("user_uuid", "slug", name="uq_user_skills_user_uuid_slug"),
    )

    user_uuid: Mapped[UUID] = mapped_column(ForeignKey("user.uuid"), index=True)
    slug: Mapped[str] = mapped_column(String(50))
    description: Mapped[None | str] = mapped_column(Text)
    content: Mapped[None | str] = mapped_column(GzipStringType)


class UserRole(Base, UUIDMixin, DateMixin):
    __tablename__ = "user_role"

    user_uuid: Mapped[UUID] = mapped_column(ForeignKey("user.uuid"), index=True)
    user = relationship("User")
    role_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("role.uuid", ondelete="CASCADE"), index=True
    )
    role = relationship("Role")


class UserUsage(Base, UUIDMixin, DateMixin):
    __tablename__ = "user_usage"

    user_uuid: Mapped[UUID] = mapped_column(
        UUIDType, ForeignKey("user.uuid"), index=True, unique=True
    )
    user = relationship("User")

    number_copilot_calls_day_count = Column(Integer, nullable=False, default=0)
    number_copilot_tokens_day_count = Column(BigInteger, nullable=False, default=0)
    total_file_upload_size_gb_count = Column(Float, nullable=False, default=0)
