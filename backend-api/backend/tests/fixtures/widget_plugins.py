"""Widget plugin packages, built in a temporary plugins directory, and the clients and
helpers the API tests use with them.

Tests generate their packages; no plugin is committed to the repository
(docs/widget-plugins/PLAN.md 0).
"""

import json
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, update

from api import models
from api.widget_plugins import service
from api.widget_plugins.discovery import package_checksum, sha256_file, version_digest
from tests.fixtures.base import _ADMIN_USER, _AUTH_USER, _SECOND_USER, settings

MEMBER = UUID(_AUTH_USER["user_uuid"])
ADMIN = UUID(_ADMIN_USER["user_uuid"])
ADMIN_ENTITY = UUID(_ADMIN_USER["entity_uuid"])
SECOND = UUID(_SECOND_USER["user_uuid"])
SECOND_ENTITY = UUID(_SECOND_USER["entity_uuid"])

ENTRY = b"export default { render({ el }) { el.textContent = 'hello'; } };\n"


def manifest(plugin_id: str = "test-chart", version: str = "1.0.0", **overrides: Any) -> dict:
    """A valid manifest; ``checksum`` is filled in by :func:`write_package`."""
    base: dict[str, Any] = {
        "manifestVersion": 1,
        "id": plugin_id,
        "version": version,
        "name": "Test chart",
        "description": "A chart for tests",
        "publisher": {"name": "Tests"},
        "host": {"api": 1, "afm": "0.11"},
        "checksum": "sha256-" + "A" * 43,
        "entry": {"module": "entry.js", "styles": ["entry.css"]},
        "contributes": {
            "widgets": [
                {
                    "id": "chart",
                    "name": "Chart",
                    "description": "Renders charts",
                    "handles": [
                        {
                            "type": "test_chart",
                            "definition": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {"title": {"type": "string", "maxLength": 80}},
                            },
                        }
                    ],
                    "permissions": ["core:data:read", "core:params:write"],
                }
            ]
        },
    }
    base.update(overrides)
    return base


def write_package(
    root: Path,
    data: dict | None = None,
    *,
    files: dict[str, bytes] | None = None,
    checksum: str | None = None,
) -> Path:
    """Write ``<root>/<id>/<version>/`` with the files and a manifest whose checksum
    matches them (unless ``checksum`` is given). Returns the version directory."""
    data = dict(data or manifest())
    directory = root / data["id"] / data["version"]
    directory.mkdir(parents=True, exist_ok=True)
    contents = files if files is not None else {"entry.js": ENTRY, "entry.css": b"body{}\n"}
    for name, content in contents.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    hashes = {
        p.relative_to(directory).as_posix(): sha256_file(p)
        for p in directory.rglob("*")
        if p.is_file() and p.name != "plugin.json"
    }
    data["checksum"] = checksum or package_checksum(hashes)
    (directory / "plugin.json").write_text(json.dumps(data), encoding="utf-8")
    return directory


def digest_of(directory: Path) -> str:
    return version_digest(
        {p.relative_to(directory).as_posix(): sha256_file(p) for p in directory.rglob("*") if p.is_file()}
    )


@pytest.fixture
def plugins_dir(tmp_path, monkeypatch):
    root = tmp_path / "plugins"
    root.mkdir()
    monkeypatch.setattr(settings, "WIDGET_PLUGINS_DIR", str(root))
    monkeypatch.setattr(settings, "WIDGET_PLUGINS_PINS", {})
    monkeypatch.setattr(settings, "WIDGET_PLUGINS_REQUIRE_PINS", False)
    return root


async def _role(db_session, entity_uuid: UUID, name: str, holders: list[UUID]) -> UUID:
    row = models.Role(uuid=uuid4(), name=name, description=name, entity_uuid=entity_uuid)
    db_session.add(row)
    await db_session.commit()
    for user_uuid in holders:
        db_session.add(models.UserRole(user_uuid=user_uuid, role_uuid=row.uuid))
    await db_session.commit()
    return row.uuid


async def _delete_roles(db_session, roles: list[UUID]) -> None:
    await db_session.execute(delete(models.RoleWidgetPlugin).where(models.RoleWidgetPlugin.role_uuid.in_(roles)))
    await db_session.execute(
        delete(models.AuditEntityRolesPermissions).where(models.AuditEntityRolesPermissions.role_uuid.in_(roles))
    )
    await db_session.execute(delete(models.UserRole).where(models.UserRole.role_uuid.in_(roles)))
    await db_session.execute(delete(models.Role).where(models.Role.uuid.in_(roles)))


@pytest.fixture
async def superuser(admin_client, db_session):
    """The admin of the admin entity, also a superuser, like the seeded administrator. The
    admin holds a role of the entity that grants nothing until a test calls :func:`grant`:
    a plugin reaches a user only through a role."""
    await db_session.execute(update(models.User).where(models.User.uuid == ADMIN).values(is_superuser=True))
    await db_session.commit()
    admin_client.plugin_role = await _role(db_session, ADMIN_ENTITY, "Plugin users", [ADMIN])  # type: ignore[attr-defined]
    yield admin_client
    await db_session.execute(delete(models.WidgetPlugin))
    await _delete_roles(db_session, [admin_client.plugin_role])
    await db_session.commit()


@pytest.fixture
async def second_user_grant(db_session):
    """Grants a plugin to the second user, through a role of their own entity."""
    roles: list[UUID] = []

    async def grant_second_user(plugin_id: str = "test-chart") -> None:
        role = await _role(db_session, SECOND_ENTITY, f"Plugin users {len(roles)}", [SECOND])
        roles.append(role)
        await service.set_role_grants(db_session, role, [{"plugin_id": plugin_id, "widget_id": "*"}])

    yield grant_second_user
    await _delete_roles(db_session, roles)
    await db_session.commit()


@pytest.fixture
async def member(auth_client, superuser, db_session):
    """The test user as a regular member of the admin's entity, plus a role helper."""
    perm = models.PermissionsEntityMap(uuid=uuid4(), entity_uuid=ADMIN_ENTITY, name="User")
    db_session.add(perm)
    await db_session.commit()
    await db_session.execute(update(models.User).where(models.User.uuid == MEMBER).values(permissions_uuid=perm.uuid))
    # The test user holds the admin's plugin role as well
    db_session.add(models.UserRole(user_uuid=MEMBER, role_uuid=superuser.plugin_role))
    await db_session.commit()
    roles: list[UUID] = []

    async def role(name: str, assign: bool = True) -> UUID:
        row = models.Role(uuid=uuid4(), name=name, description=name, entity_uuid=ADMIN_ENTITY)
        db_session.add(row)
        await db_session.commit()
        if assign:
            db_session.add(models.UserRole(user_uuid=MEMBER, role_uuid=row.uuid))
            await db_session.commit()
        roles.append(row.uuid)
        return row.uuid

    auth_client.role = role  # type: ignore[attr-defined]
    yield auth_client

    await _delete_roles(db_session, roles)
    await db_session.execute(
        delete(models.UserRole).where(
            models.UserRole.user_uuid == MEMBER, models.UserRole.role_uuid == superuser.plugin_role
        )
    )
    await db_session.execute(
        update(models.User).where(models.User.uuid == MEMBER).values(permissions_uuid=_AUTH_USER["perm_uuid"])
    )
    await db_session.execute(delete(models.PermissionsEntityMap).where(models.PermissionsEntityMap.uuid == perm.uuid))
    await db_session.commit()


async def rescan(client):
    response = await client.post("/plugins/rescan")
    assert response.status_code == 200, response.text
    return response.json()


async def plugin_view(client, plugin_id="test-chart"):
    response = await client.get("/plugins")
    assert response.status_code == 200, response.text
    return next(p for p in response.json()["plugins"] if p["plugin_id"] == plugin_id)


def version_view(plugin, version="1.0.0"):
    return next(v for v in plugin["versions"] if v["version"] == version)


async def approve(client, plugin_id="test-chart", version="1.0.0"):
    view = version_view(await plugin_view(client, plugin_id), version)
    keys = [item["key"] for item in view["review"] if item["added"]]
    response = await client.post(
        f"/plugins/{plugin_id}/versions/{version}/approve",
        json={"digest": view["digest"], "acknowledged": keys},
    )
    assert response.status_code == 200, response.text
    return view


async def enable(client, plugin_id="test-chart", **changes):
    response = await client.put(f"/admin/plugins/{plugin_id}", json={"enabled": True, **changes})
    assert response.status_code == 200, response.text


async def grant(superuser, plugin_id="test-chart", widget_id="*"):
    """Grant the plugin's widget (``*``: all of them) to the role the admin and the test
    user hold."""
    path = f"/admin/role/{superuser.plugin_role}/plugin-access"
    response = await superuser.get(path)
    assert response.status_code == 200, response.text
    grants = [*response.json()["grants"], {"plugin_id": plugin_id, "widget_id": widget_id}]
    response = await superuser.put(path, json={"grants": grants})
    assert response.status_code == 200, response.text


async def user_listing(client):
    response = await client.get("/app/widget-plugins")
    assert response.status_code == 200, response.text
    return response.json()
