"""The values of the secrets plugins declare (docs/widget-plugins/SERVER-SIDE.md 4).

A manifest declares a secret by name and purpose. Its value comes from the deployment,
as the file ``<WIDGET_PLUGIN_SECRETS_DIR>/<plugin id>/<secret name>``, or from a
superuser, write-only, stored encrypted in ``widget_plugin_secret``. The deployment's
value wins. A value is read only to fill the headers of a proxy that names it: no
endpoint, listing, log line or event carries one.
"""

import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import models
from api.models.widget_plugin_models import VERSION_MISSING
from utilities.config import settings

MAX_SECRET_LENGTH = 4096
SOURCE_CONFIGURATION = "configuration"
SOURCE_ADMIN = "admin"

# A value goes into a header: printable ASCII, no line breaks
_VALUE = re.compile(r"[\x20-\x7e]+")


def value_problem(value: str) -> str | None:
    """Why a value cannot be used, in words that do not repeat it."""
    if not value:
        return "the value is empty"
    if len(value) > MAX_SECRET_LENGTH:
        return f"the value is longer than {MAX_SECRET_LENGTH} characters"
    if not _VALUE.fullmatch(value):
        return "the value has a character that is not printable ASCII"
    return None


def configured(plugin_id: str, name: str) -> str | None:
    """The deployment's value: the file's text without its final line break, or None
    when there is no file. Plugin ids and secret names cannot leave the directory."""
    if not settings.WIDGET_PLUGIN_SECRETS_DIR:
        return None
    path = Path(settings.WIDGET_PLUGIN_SECRETS_DIR) / plugin_id / name
    try:
        if not path.is_file():
            return None
        with path.open("rb") as handle:
            raw = handle.read(MAX_SECRET_LENGTH + 2)
    except OSError:
        return None
    return raw.decode("utf-8", errors="replace").removesuffix("\n").removesuffix("\r")


def declared(versions: Iterable[models.WidgetPluginVersion]) -> dict[str, str]:
    """Name to purpose for every secret a version on disk declares, newest first."""
    found: dict[str, str] = {}
    for row in versions:
        if row.state == VERSION_MISSING:
            continue
        for secret in (row.manifest or {}).get("secrets") or []:
            found.setdefault(secret["name"], secret.get("purpose", ""))
    return found


async def stored(db: AsyncSession, plugin_uuid: UUID) -> dict[str, models.WidgetPluginSecret]:
    rows = await db.execute(select(models.WidgetPluginSecret).where(models.WidgetPluginSecret.plugin_uuid == plugin_uuid))
    return {row.name: row for row in rows.scalars()}


async def status(
    db: AsyncSession, plugin: models.WidgetPlugin, versions: Iterable[models.WidgetPluginVersion]
) -> list[dict[str, Any]]:
    """Whether each secret is set, by whom and when; never the value. A stored value
    for a secret no version declares any more is listed so a superuser can clear it."""
    names = declared(versions)
    rows = await stored(db, plugin.uuid)
    result = []
    for name in [*names, *sorted(set(rows) - set(names))]:
        value = configured(plugin.plugin_id, name)
        row = rows.get(name)
        entry: dict[str, Any] = {
            "name": name,
            "purpose": names.get(name, ""),
            "declared": name in names,
            "set": False,
            "source": None,
            "problem": None,
            "set_by_uuid": None,
            "set_at": None,
        }
        if value is not None:
            entry.update(set=True, source=SOURCE_CONFIGURATION, problem=value_problem(value))
        elif row is not None:
            entry.update(
                set=True, source=SOURCE_ADMIN, set_by_uuid=row.set_by_uuid, set_at=row.updated_date or row.created_date
            )
        result.append(entry)
    return result


async def resolve(db: AsyncSession, plugin: models.WidgetPlugin, names: Iterable[str]) -> dict[str, str]:
    """The usable values of the named secrets. One without a usable value is left out,
    and the call that needs it fails with ``secret_missing``."""
    values: dict[str, str] = {}
    rows: dict[str, models.WidgetPluginSecret] | None = None
    for name in names:
        value = configured(plugin.plugin_id, name)
        if value is None:
            if rows is None:
                rows = await stored(db, plugin.uuid)
            row = rows.get(name)
            value = (row.value or {}).get("value") if row is not None else None
        if isinstance(value, str) and value_problem(value) is None:
            values[name] = value
    return values
