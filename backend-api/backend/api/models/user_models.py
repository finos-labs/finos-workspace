"""User models"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Column,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy_utils import EmailType, IPAddressType, UUIDType

from api import base
from api.models.entity_models import PermissionsEntityMap
from api.models.model_helpers import (
    AwareDateTime,
    Base,
    DateMixin,
    GzipJsonType,
    GzipStringType,
    JSONType,
    PasswordType,
    UserDisplaySettingsType,
    UUIDMixin,
)


class User(Base, UUIDMixin, DateMixin):
    """
    A unique user on our platform.
    Users must have unique emails and can delete their accounts
    """

    __tablename__ = "user"

    microsoft_id: Mapped[None | str] = mapped_column(String(100), default=None)
    first_name: Mapped[None | str] = mapped_column(String(100), default=None)
    last_name: Mapped[None | str] = mapped_column(String(100), default=None)
    email: Mapped[str] = mapped_column(EmailType, unique=True)
    clean_email: Mapped[str] = mapped_column(EmailType)
    username: Mapped[None | str] = mapped_column(String(50), unique=True)
    password: Mapped[str] = mapped_column(PasswordType, nullable=False)
    totp_secret: Mapped[None | str] = mapped_column(String(32), default=None)
    totp_active: Mapped[bool] = mapped_column(Boolean, default=False)
    two_factor_auth: Mapped[bool] = mapped_column(Boolean, default=False)
    temporary_password: Mapped[None | bool] = mapped_column(Boolean, default=False)
    # This is the currently active json token
    auth_token: Mapped[None | str] = mapped_column(Text)

    logins = relationship("Login", back_populates="user")

    # JSON columns
    display_settings = Column(UserDisplaySettingsType)

    referred_by = Column(String(100), default=None)
    # The below tracks whether the user the referred them has been rewarded
    referred_by_sent = Column(Boolean, default=False)
    referral_code = Column(
        String(100), unique=True, nullable=False, default=base.random_string
    )
    total_referrals: Mapped[None | int] = mapped_column(Integer, default=0)

    deleted = Column(Boolean, default=False)
    confirmed = Column(Boolean, default=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)
    can_submit_marketplace: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    # App fields
    permissions_uuid: Mapped[None | UUID] = mapped_column(
        ForeignKey("permissions_entity_map.uuid"), index=True
    )
    permissions: Mapped[Optional["PermissionsEntityMap"]] = relationship()
    billing_active: Mapped[None | bool] = mapped_column(Boolean, default=False)
    app_start: Mapped[None | datetime] = mapped_column(AwareDateTime())
    latest_version: Mapped[None | str] = mapped_column(Text)

    def __str__(self) -> str:
        return str(self.email)


class Session(Base, UUIDMixin, DateMixin):
    "A login session for a user"

    __tablename__ = "session"

    user_uuid: Mapped[None | UUID] = mapped_column(
        UUIDType, ForeignKey("user.uuid"), index=True
    )
    user = relationship("User")
    api_token = Column(String(300), default=None)
    expiration_date: Mapped[None | datetime] = mapped_column(AwareDateTime())
    app_session: Mapped[bool] = mapped_column(Boolean, default=False)
    source = Column(String(20), default=None)


class PersonalAccessToken(Base, UUIDMixin, DateMixin):
    "A durable user-owned API credential for scoped integrations"

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
    "A record of when and where users log in"

    __tablename__ = "login"

    user_uuid: Mapped[None | UUID] = mapped_column(
        UUIDType, ForeignKey("user.uuid"), index=True
    )
    user = relationship("User", back_populates="logins")
    ip_address: Mapped[None | str] = mapped_column(IPAddressType)
    source = Column(String(20), default=None)

    def __str__(self) -> str:
        return f"{self.user_uuid}-{self.created_date}"


class UserInvite(Base, UUIDMixin, DateMixin):
    "Invitations that provision a user before their first sign-in"

    __tablename__ = "user_invite"

    # None for a user who signs up through single sign-on
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
    "Stores the user's prompts"

    __tablename__ = "user_prompts"

    user_uuid: Mapped[UUID] = mapped_column(ForeignKey("user.uuid"), index=True)
    prompt: Mapped[dict | list[dict] | None] = mapped_column(
        GzipJsonType,
    )


class UserSkills(Base, UUIDMixin, DateMixin):
    "Stores the user's skills"

    __tablename__ = "user_skills"
    __table_args__ = (
        UniqueConstraint("user_uuid", "slug", name="uq_user_skills_user_uuid_slug"),
    )

    user_uuid: Mapped[UUID] = mapped_column(ForeignKey("user.uuid"), index=True)
    slug: Mapped[str] = mapped_column(String(50))
    description: Mapped[None | str] = mapped_column(Text)
    content: Mapped[None | str] = mapped_column(GzipStringType)


class UserRole(Base, UUIDMixin, DateMixin):
    "Stores the user's role"

    __tablename__ = "user_role"

    user_uuid: Mapped[UUID] = mapped_column(ForeignKey("user.uuid"), index=True)
    user = relationship("User")
    role_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("role.uuid", ondelete="CASCADE"), index=True
    )
    role = relationship("Role")
