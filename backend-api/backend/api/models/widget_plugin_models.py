"""Widget plugin models (docs/widget-plugins/DESIGN.md 6.3).

Package files stay in the plugins directory. The database holds what discovery found
and the decisions: a superuser's approval of a version, each entity's enablement and
narrowing, role grants, viz-type handler choices, events and blocked-request reports.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy_utils import UUIDType

from api.models.model_helpers import (
    AwareDateTime,
    Base,
    DateMixin,
    EncryptedType,
    GzipJsonType,
    JSONType,
    UUIDMixin,
)

# A plugin's platform status
PLUGIN_DISABLED = "disabled"
PLUGIN_ENABLED = "enabled"
PLUGIN_REVOKED = "revoked"

# A version's state
VERSION_DISCOVERED = "discovered"
VERSION_ACTIVE = "active"
VERSION_BLOCKED = "blocked"
VERSION_RETIRED = "retired"
VERSION_MISSING = "missing"

ACCESS_EVERYONE = "everyone"
ACCESS_ROLES = "roles"


class WidgetPlugin(Base, UUIDMixin, DateMixin):
    """A plugin the deployer placed in the plugins directory."""

    __tablename__ = "widget_plugin"

    plugin_id: Mapped[str] = mapped_column(String(48), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    # disabled until a superuser approves a version; revoked is the kill switch
    status: Mapped[str] = mapped_column(String(16), default=PLUGIN_DISABLED)
    # The version being served, when there is one
    active_version: Mapped[str | None] = mapped_column(String(32), default=None)
    # Superuser overrides: {"csp": {directive: [sources]}, "confirmations": [...]}
    overrides: Mapped[dict | None] = mapped_column(JSONType, default=None)


class WidgetPluginVersion(Base, UUIDMixin, DateMixin):
    """One version directory of a plugin, as discovery found it."""

    __tablename__ = "widget_plugin_version"
    __table_args__ = (UniqueConstraint("plugin_uuid", "version", name="uix_widget_plugin_version"),)

    plugin_uuid: Mapped[UUID] = mapped_column(ForeignKey("widget_plugin.uuid", ondelete="CASCADE"), index=True)
    plugin: Mapped["WidgetPlugin"] = relationship(foreign_keys=[plugin_uuid])
    version: Mapped[str] = mapped_column(String(32))
    digest: Mapped[str | None] = mapped_column(String(80), default=None)
    declared_checksum: Mapped[str | None] = mapped_column(String(80), default=None)
    pin_status: Mapped[str] = mapped_column(String(16), default="unpinned")
    manifest: Mapped[dict | None] = mapped_column(GzipJsonType, default=None)
    # Served path -> {"size": int, "sha256": hex}
    files: Mapped[dict | None] = mapped_column(JSONType, default=None)
    path: Mapped[str] = mapped_column(String(120))
    state: Mapped[str] = mapped_column(String(16), default=VERSION_DISCOVERED)
    blocked_reason: Mapped[str | None] = mapped_column(Text, default=None)
    findings: Mapped[dict | None] = mapped_column(JSONType, default=None)
    discovered_at: Mapped[datetime | None] = mapped_column(AwareDateTime(), default=None)
    # What the superuser accepted for this version
    approved: Mapped[dict | None] = mapped_column(JSONType, default=None)
    approved_by_uuid: Mapped[UUID | None] = mapped_column(UUIDType, default=None)
    approved_at: Mapped[datetime | None] = mapped_column(AwareDateTime(), default=None)


class EntityWidgetPlugin(Base, UUIDMixin, DateMixin):
    """Whether, and for whom, an entity uses a plugin."""

    __tablename__ = "entity_widget_plugin"
    __table_args__ = (UniqueConstraint("entity_uuid", "plugin_uuid", name="uix_entity_widget_plugin"),)

    entity_uuid: Mapped[UUID] = mapped_column(ForeignKey("entity.uuid", ondelete="CASCADE"), index=True)
    plugin_uuid: Mapped[UUID] = mapped_column(ForeignKey("widget_plugin.uuid", ondelete="CASCADE"), index=True)
    plugin: Mapped["WidgetPlugin"] = relationship(foreign_keys=[plugin_uuid])
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    access_mode: Mapped[str] = mapped_column(String(16), default=ACCESS_ROLES)
    settings: Mapped[dict | None] = mapped_column(JSONType, default=None)
    # Permissions removed for this entity
    narrowed_permissions: Mapped[list | None] = mapped_column(JSONType, default=None)
    # directive -> the only sources this entity allows
    csp_narrow: Mapped[dict | None] = mapped_column(JSONType, default=None)
    # Hosts of the approved server.network removed for this entity
    server_network_narrow: Mapped[list | None] = mapped_column(JSONType, default=None)
    # Data source id the plugin declares -> the uuid of the entity's backend that serves it
    data_sources: Mapped[dict | None] = mapped_column(JSONType, default=None)


class EntityVizHandler(Base, UUIDMixin, DateMixin):
    """Which plugin widget renders a viz type for an entity, when several could."""

    __tablename__ = "entity_viz_handler"
    __table_args__ = (UniqueConstraint("entity_uuid", "viz_type", name="uix_entity_viz_handler"),)

    entity_uuid: Mapped[UUID] = mapped_column(ForeignKey("entity.uuid", ondelete="CASCADE"), index=True)
    viz_type: Mapped[str] = mapped_column(String(32))
    plugin_uuid: Mapped[UUID] = mapped_column(ForeignKey("widget_plugin.uuid", ondelete="CASCADE"), index=True)
    widget_id: Mapped[str] = mapped_column(String(48))


class RoleWidgetPlugin(Base, UUIDMixin, DateMixin):
    """A plugin widget, or all widgets of a plugin (``*``), that a role may use."""

    __tablename__ = "role_widget_plugin"
    __table_args__ = (UniqueConstraint("role_uuid", "plugin_uuid", "widget_id", name="uix_role_widget_plugin"),)

    role_uuid: Mapped[UUID] = mapped_column(ForeignKey("role.uuid", ondelete="CASCADE"), index=True)
    role = relationship("Role", foreign_keys=[role_uuid])
    plugin_uuid: Mapped[UUID] = mapped_column(ForeignKey("widget_plugin.uuid", ondelete="CASCADE"), index=True)
    plugin: Mapped["WidgetPlugin"] = relationship(foreign_keys=[plugin_uuid])
    widget_id: Mapped[str] = mapped_column(String(48), default="*")


class WidgetPluginEvent(Base, UUIDMixin, DateMixin):
    """A platform or entity action on a plugin: discovery, approval, revocation..."""

    __tablename__ = "widget_plugin_event"

    plugin_uuid: Mapped[UUID] = mapped_column(ForeignKey("widget_plugin.uuid", ondelete="CASCADE"), index=True)
    version: Mapped[str | None] = mapped_column(String(32), default=None)
    entity_uuid: Mapped[UUID | None] = mapped_column(UUIDType, default=None, index=True)
    actor_uuid: Mapped[UUID | None] = mapped_column(UUIDType, default=None)
    action: Mapped[str] = mapped_column(String(48))
    details: Mapped[dict | None] = mapped_column(JSONType, default=None)


class WidgetPluginCspReport(Base, UUIDMixin, DateMixin):
    """Requests a plugin frame's policy blocked, counted per directive and origin."""

    __tablename__ = "widget_plugin_csp_report"
    __table_args__ = (
        UniqueConstraint(
            "plugin_uuid",
            "entity_uuid",
            "directive",
            "blocked_origin",
            name="uix_widget_plugin_csp_report",
        ),
    )

    plugin_uuid: Mapped[UUID] = mapped_column(ForeignKey("widget_plugin.uuid", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(32))
    entity_uuid: Mapped[UUID] = mapped_column(ForeignKey("entity.uuid", ondelete="CASCADE"), index=True)
    directive: Mapped[str] = mapped_column(String(32))
    blocked_origin: Mapped[str] = mapped_column(String(255))
    count: Mapped[int] = mapped_column(Integer, default=0)
    first_seen: Mapped[datetime | None] = mapped_column(AwareDateTime(), default=None)
    last_seen: Mapped[datetime | None] = mapped_column(AwareDateTime(), default=None)


class WidgetPluginSecret(Base, UUIDMixin, DateMixin):
    """The value a superuser set for a secret a plugin declares (docs/widget-plugins/
    SERVER-SIDE.md 4), encrypted at rest. Never returned by an endpoint or logged."""

    __tablename__ = "widget_plugin_secret"
    __table_args__ = (UniqueConstraint("plugin_uuid", "name", name="uix_widget_plugin_secret"),)

    plugin_uuid: Mapped[UUID] = mapped_column(ForeignKey("widget_plugin.uuid", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    # {"value": "..."}
    value: Mapped[dict] = mapped_column(EncryptedType)
    set_by_uuid: Mapped[UUID | None] = mapped_column(UUIDType, default=None)
