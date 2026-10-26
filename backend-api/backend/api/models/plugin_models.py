"""Plugin models

A superuser installs a plugin from the plugin host's registry: they approve one released
version, pinned by its digest, for the whole Workspace. Only an installed plugin can be
enabled by an organization's admin, and only an installed plugin enabled for a user's
organization reaches that user and their dashboards.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy_utils import UUIDType

from api import base
from api.models.model_helpers import AwareDateTime, Base, DateMixin, GzipJsonType, UUIDMixin

PLUGIN_ID_LENGTH = 100


class PluginInstallation(Base, UUIDMixin, DateMixin):
    """A plugin a superuser installed: the approved version, its release digest and a
    snapshot of that release (files, what the plugin asks for, release notes, source),
    so a later release can be reviewed against it and a changed one is detected."""

    __tablename__ = "plugin_installation"

    plugin_id: Mapped[str] = mapped_column(
        String(PLUGIN_ID_LENGTH), unique=True, index=True, nullable=False
    )
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    # "sha256:" and 64 hex digits
    digest: Mapped[str] = mapped_column(String(71), nullable=False)
    # {"files", "requests", "release_notes", "source"} of the approved release
    release: Mapped[dict] = mapped_column(GzipJsonType, nullable=False)
    approved_at: Mapped[datetime] = mapped_column(
        AwareDateTime(), default=base.get_now, nullable=False
    )
    approved_by_uuid: Mapped[UUID | None] = mapped_column(
        UUIDType, ForeignKey("user.uuid", ondelete="SET NULL"), index=True
    )


class EntityPlugin(Base, UUIDMixin, DateMixin):
    """An installed plugin an admin enabled for their organization. Uninstalling the
    plugin, or deleting the organization, removes the row."""

    __tablename__ = "entity_plugin"
    __table_args__ = (
        UniqueConstraint("entity_uuid", "plugin_id", name="uix_entity_plugin"),
    )

    entity_uuid: Mapped[UUID] = mapped_column(
        UUIDType, ForeignKey("entity.uuid", ondelete="CASCADE"), index=True, nullable=False
    )
    plugin_id: Mapped[str] = mapped_column(
        String(PLUGIN_ID_LENGTH),
        ForeignKey("plugin_installation.plugin_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    enabled_by_uuid: Mapped[UUID | None] = mapped_column(
        UUIDType, ForeignKey("user.uuid", ondelete="SET NULL"), index=True
    )
