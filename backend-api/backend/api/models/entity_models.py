from datetime import UTC, datetime
from typing import Self
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    select,
    true,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy_utils import UUIDType

from api.models.model_helpers import (
    AwareDateTime,
    Base,
    DateMixin,
    GzipJsonType,
    UUIDMixin,
)

ADMIN_TYPE = "Admin"
DEVELOPER_TYPE = "Developer"
USER_TYPE = "User"
USER_TYPES = (ADMIN_TYPE, DEVELOPER_TYPE, USER_TYPE)
CONNECTION_TYPES = (ADMIN_TYPE, DEVELOPER_TYPE)

SHARING_NONE = "none"
SHARING_RECEIVE = "receive"
SHARING_SHARE = "share"
SHARING_LEVELS = (SHARING_NONE, SHARING_RECEIVE, SHARING_SHARE)


async def entity_get_supreme(db: AsyncSession, self_uuid: UUID) -> None | UUID:
    query = select(EntityRelationship.supreme_uuid).where(
        EntityRelationship.child_uuid == self_uuid
    )
    child = (await db.execute(query)).first()
    if child:
        return child[0]
    query = select(EntityRelationship.supreme_uuid).where(
        EntityRelationship.parent_uuid == self_uuid
    )
    parent = (await db.execute(query)).first()
    if parent:
        return parent.supreme_uuid
    return None


class Entity(Base, UUIDMixin, DateMixin):
    __tablename__ = "entity"

    name: Mapped[None | str] = mapped_column(String(100), unique=True)
    require_authenticator: Mapped[bool] = mapped_column(Boolean, default=False)
    sharing_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )


class EntityRelationship(Base, UUIDMixin, DateMixin):
    __tablename__ = "entity_relationship"

    parent_uuid: Mapped[UUID] = mapped_column(ForeignKey("entity.uuid"), index=True)
    parent: Mapped["Entity"] = relationship(foreign_keys=[parent_uuid], lazy="selectin")
    child_uuid: Mapped[UUID] = mapped_column(ForeignKey("entity.uuid"), index=True)
    child: Mapped["Entity"] = relationship(foreign_keys=[child_uuid], lazy="selectin")
    supreme_uuid: Mapped[UUID] = mapped_column(ForeignKey("entity.uuid"), index=True)
    supreme: Mapped["Entity"] = relationship(
        foreign_keys=[supreme_uuid], lazy="selectin"
    )


class PermissionsEntityMap(Base, UUIDMixin, DateMixin):
    __tablename__ = "permissions_entity_map"

    entity_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("entity.uuid", ondelete="CASCADE"), index=True
    )
    entity: Mapped["Entity"] = relationship(foreign_keys=[entity_uuid], lazy="selectin")
    name: Mapped[str] = mapped_column(String(100))


class AuditEntityRolesPermissions(Base, UUIDMixin, DateMixin):
    __tablename__ = "audit_entity_roles_permissions"

    entity_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("entity.uuid", ondelete="CASCADE"), index=True
    )
    entity: Mapped["Entity"] = relationship(foreign_keys=[entity_uuid])
    role_uuid: Mapped[UUID] = mapped_column(ForeignKey("role.uuid"), index=True)
    role: Mapped["Role"] = relationship(foreign_keys=[role_uuid])
    action: Mapped[str] = mapped_column(String(100))
    resource_type: Mapped[str] = mapped_column(String(100))
    resource_uuid: Mapped[UUID] = mapped_column(UUIDType, index=True)
    performed_by_uuid: Mapped[UUID] = mapped_column(ForeignKey("user.uuid"), index=True)
    details: Mapped[dict] = mapped_column(GzipJsonType)


class Role(Base, UUIDMixin, DateMixin):
    __tablename__ = "role"
    __table_args__ = (
        UniqueConstraint(
            "entity_uuid", "name", "deleted_at", name="uix_role_entity_name_deleted_at"
        ),
        CheckConstraint(
            "sharing IN ('none', 'receive', 'share')", name="check_role_sharing"
        ),
    )

    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    sharing: Mapped[str] = mapped_column(
        String(10), default=SHARING_NONE, server_default=SHARING_NONE
    )
    copilot_calls_day: Mapped[int | None] = mapped_column(Integer)
    copilot_tokens_day: Mapped[int | None] = mapped_column(BigInteger)
    upload_size_gb: Mapped[int | None] = mapped_column(Integer)
    search_web: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    fetch_from_web: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    entity_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("entity.uuid", ondelete="CASCADE"), index=True
    )
    entity: Mapped["Entity"] = relationship(foreign_keys=[entity_uuid])
    deleted_at: Mapped[datetime | None] = mapped_column(
        AwareDateTime(timezone=True), nullable=True
    )

    async def soft_delete(self, db: AsyncSession) -> Self:
        self.deleted_at = datetime.now(UTC)
        await db.flush()
        return self


class RoleBackend(Base, UUIDMixin, DateMixin):
    __tablename__ = "role_backend"

    role_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("role.uuid", ondelete="CASCADE"), index=True
    )
    role: Mapped["Role"] = relationship(foreign_keys=[role_uuid])
    backend_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("api_source.uuid", ondelete="CASCADE"), index=True
    )
    backend = relationship("ApiSource")
    access: Mapped[str] = mapped_column(String(100))
    widgets: Mapped[list[dict] | None] = mapped_column(GzipJsonType)
    templates: Mapped[list[dict] | None] = mapped_column(GzipJsonType)


class RoleFile(Base, UUIDMixin, DateMixin):
    __tablename__ = "role_file"

    role_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("role.uuid", ondelete="CASCADE"), index=True
    )
    role: Mapped["Role"] = relationship(foreign_keys=[role_uuid])
    file_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("file_widget.uuid", ondelete="CASCADE"), index=True
    )
    file = relationship("FileWidget")
    access: Mapped[str] = mapped_column(String(100))


class RolePrompt(Base, UUIDMixin, DateMixin):
    __tablename__ = "role_prompt"

    role_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("role.uuid", ondelete="CASCADE"), index=True
    )
    role: Mapped["Role"] = relationship(foreign_keys=[role_uuid])
    prompt_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("user_prompts.uuid", ondelete="CASCADE"), index=True
    )
    prompt = relationship("UserPrompts")
    access: Mapped[str] = mapped_column(String(100))


class RoleCopilotModel(Base, UUIDMixin, DateMixin):
    __tablename__ = "role_copilot_model"
    __table_args__ = (
        UniqueConstraint(
            "role_uuid", "agent_id", "model_id", name="uix_role_copilot_model"
        ),
    )

    role_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("role.uuid", ondelete="CASCADE"), index=True
    )
    role: Mapped["Role"] = relationship(foreign_keys=[role_uuid])
    agent_id: Mapped[str] = mapped_column(String(255))
    model_id: Mapped[str] = mapped_column(String(255))


class RoleMcpAccess(Base, UUIDMixin, DateMixin):
    __tablename__ = "role_mcp_access"
    __table_args__ = (
        UniqueConstraint(
            "role_uuid", "server_url", "tool_name", name="uix_role_mcp_access"
        ),
    )

    role_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("role.uuid", ondelete="CASCADE"), index=True
    )
    role: Mapped["Role"] = relationship(foreign_keys=[role_uuid])
    server_url: Mapped[str] = mapped_column(String(400))
    tool_name: Mapped[str] = mapped_column(String(200), default="*")


class EntityThemeSettings(Base, UUIDMixin, DateMixin):
    __tablename__ = "entity_theme_settings"

    entity_uuid: Mapped[UUID] = mapped_column(
        ForeignKey("entity.uuid", ondelete="CASCADE"), index=True
    )
    settings: Mapped[dict] = mapped_column(GzipJsonType)
