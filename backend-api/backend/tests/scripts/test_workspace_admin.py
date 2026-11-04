import asyncio
import io
import json
import sys
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, select

from api import auth_helpers, models
from scripts import workspace_admin
from tests.fixtures.base import _set_fk_checks
from tests.fixtures.plugin_backends import backend_manifest
from tests.fixtures.widget_plugins import write_package
from utilities.config import settings
from utilities.log_helpers import setup_logging, stdoutSink


@pytest.fixture
async def cli(db_session, monkeypatch, capsys):
    loop = asyncio.get_running_loop()

    async def run_on_the_test_session(action):
        return await asyncio.wrap_future(
            asyncio.run_coroutine_threadsafe(action(db_session), loop)
        )

    monkeypatch.setattr(workspace_admin, "run", run_on_the_test_session)
    workspace_admin.log_to_stderr()
    created: dict[str, list] = {"emails": [], "entities": []}

    async def command(*argv: str) -> tuple[int, str, str]:
        capsys.readouterr()
        try:
            await asyncio.to_thread(workspace_admin.main, list(argv))
            status = 0
        except SystemExit as exit_:
            status = int(exit_.code or 0)
        shown = capsys.readouterr()
        return status, shown.out, shown.err

    command.created = created  # type: ignore[attr-defined]
    yield command
    setup_logging(settings)

    await _set_fk_checks(db_session, enabled=False)
    users = select(models.User.uuid).where(models.User.email.in_(created["emails"]))
    await db_session.execute(
        delete(models.Session).where(models.Session.user_uuid.in_(users))
    )
    await db_session.execute(
        delete(models.User).where(models.User.email.in_(created["emails"]))
    )
    for table in (models.ApiSource, models.PermissionsEntityMap):
        await db_session.execute(
            delete(table).where(table.entity_uuid.in_(created["entities"]))
        )
    await db_session.execute(
        delete(models.Entity).where(models.Entity.uuid.in_(created["entities"]))
    )
    await _set_fk_checks(db_session, enabled=True)
    await db_session.commit()


async def _entity(cli, tmp_path, **changes) -> str:
    config = tmp_path / f"entity-{uuid4().hex[:6]}.json"
    config.write_text(
        json.dumps(
            {
                "name": f"CLI entity {uuid4().hex[:8]}",
                "admin_email": "admin@example.com",
                **changes,
            }
        )
    )
    status, out, err = await cli("entity", "create", "--config", str(config), "--json")
    assert status == 0, err
    entity_uuid = json.loads(out)["entity_uuid"]
    cli.created["entities"].append(entity_uuid)
    return entity_uuid


async def _user(cli, entity_uuid: str, role: str = "user") -> tuple[str, dict]:
    email = f"cli-{uuid4().hex[:8]}@example.com"
    cli.created["emails"].append(email)
    status, out, err = await cli(
        "user", "create", entity_uuid, "--email", email,
        "--first-name", "Cli", "--last-name", "User", "--role", role, "--json",
    )  # fmt: skip
    assert status == 0, err
    return email, json.loads(out)


async def _user_of_link(link: str):
    return await auth_helpers.take_password_reset(urlsplit(link).fragment)


class TestEntities:
    @pytest.mark.asyncio
    async def test_an_entity_is_created_shown_updated_and_deleted(self, cli, tmp_path):
        entity_uuid = await _entity(cli, tmp_path)

        status, out, _ = await cli("entity", "show", entity_uuid, "--json")
        assert status == 0
        shown = json.loads(out)
        assert shown["sharing_enabled"] is True

        status, out, _ = await cli(
            "entity", "update", entity_uuid, "--data", '{"sharing_enabled": false}'
        )
        assert (status, out.strip()) == (0, f"✓ Entity {entity_uuid} updated")
        status, out, _ = await cli("entity", "show", entity_uuid, "--json")
        assert json.loads(out)["sharing_enabled"] is False
        assert json.loads(out)["name"] == shown["name"]

        status, out, _ = await cli("entity", "list")
        assert f"{entity_uuid} | {shown['name']} | Sharing: off" in out

        status, out, _ = await cli("entity", "delete", entity_uuid)
        assert (status, out.strip()) == (0, f"✓ Entity {entity_uuid} deleted")
        status, _, err = await cli("entity", "show", entity_uuid)
        assert status == 1
        assert err.strip() == f"✗ Error (404): Entity {entity_uuid} not found"

    @pytest.mark.asyncio
    async def test_an_entity_with_users_is_not_deleted(self, cli, tmp_path):
        entity_uuid = await _entity(cli, tmp_path)
        await _user(cli, entity_uuid)

        status, _, err = await cli("entity", "delete", entity_uuid)

        assert status == 1
        assert err.strip() == "✗ Error (400): Cannot delete entity with existing users"

    @pytest.mark.asyncio
    async def test_a_config_that_is_not_an_entity_is_refused(self, cli, tmp_path):
        config = tmp_path / "bad.json"
        config.write_text('{"name": "No type"}')

        status, _, err = await cli("entity", "create", "--config", str(config))

        assert status == 1
        assert err.startswith("✗ Error:")


class TestUsers:
    @pytest.mark.asyncio
    async def test_a_new_user_gets_the_link_that_sets_their_password(
        self, cli, tmp_path, db_session
    ):
        entity_uuid = await _entity(cli, tmp_path)

        email, answer = await _user(cli, entity_uuid, role="developer")

        assert set(answer) == {"success", "link", "expires_at", "email", "role"}
        user = (
            await db_session.execute(select(models.User).where(models.User.email == email))
        ).scalar_one()
        assert await _user_of_link(answer["link"]) == user.uuid
        user_type = await db_session.get(models.PermissionsEntityMap, user.permissions_uuid)
        assert (str(user_type.entity_uuid), user_type.name) == (
            entity_uuid,
            models.DEVELOPER_TYPE,
        )

    @pytest.mark.asyncio
    async def test_the_link_is_printed_for_the_operator(self, cli, tmp_path):
        entity_uuid = await _entity(cli, tmp_path)
        email = f"cli-{uuid4().hex[:8]}@example.com"
        cli.created["emails"].append(email)

        status, out, _ = await cli(
            "user",
            "create",
            entity_uuid,
            "--email",
            email,
            "--first-name",
            "A",
            "--last-name",
            "B",
        )

        assert status == 0
        first, link = out.strip().splitlines()
        assert first.startswith(
            f"✓ User created. Give {email} this link to set their password."
        )
        assert "/reset-password#" in link

    @pytest.mark.asyncio
    async def test_the_link_is_printed_as_it_is_past_the_logs_redaction(
        self, cli, tmp_path, monkeypatch, capsys
    ):
        entity_uuid = await _entity(cli, tmp_path)
        email = f"cli-{uuid4().hex[:8]}@example.com"
        cli.created["emails"].append(email)
        monkeypatch.setattr(sys, "__stdout__", sys.stdout)
        monkeypatch.setattr(sys, "stdout", stdoutSink())

        status, out, _ = await cli(
            "user",
            "create",
            entity_uuid,
            "--email",
            email,
            "--first-name",
            "A",
            "--last-name",
            "B",
        )

        assert status == 0
        assert f"{settings.APPURL.rstrip('/')}/reset-password#" in out

    @pytest.mark.asyncio
    async def test_a_reset_ends_the_password_and_gives_a_new_link(
        self, cli, tmp_path, db_session
    ):
        entity_uuid = await _entity(cli, tmp_path)
        email, created = await _user(cli, entity_uuid)

        status, out, _ = await cli("user", "reset-password", email, "--json")

        assert status == 0
        user = (
            await db_session.execute(select(models.User).where(models.User.email == email))
        ).scalar_one()
        assert await _user_of_link(created["link"]) is None
        assert await _user_of_link(json.loads(out)["link"]) == user.uuid

    @pytest.mark.asyncio
    async def test_users_are_listed_moved_and_removed(self, cli, tmp_path, db_session):
        entity_uuid = await _entity(cli, tmp_path)
        other_uuid = await _entity(cli, tmp_path)
        email, _ = await _user(cli, entity_uuid)

        status, out, _ = await cli("user", "list", "--email", email)
        assert status == 0
        assert f"| {email} | {models.USER_TYPE} |" in out

        status, out, _ = await cli(
            "user", "move", "--entity-uuid", other_uuid, "--email", email, "--role", "admin"
        )
        assert (status, out.strip()) == (
            0,
            f"✓ User {email} moved to entity {other_uuid} as {models.ADMIN_TYPE}",
        )

        status, out, _ = await cli("user", "delete", email)
        assert (status, out.strip()) == (0, f"✓ User {email} deleted")
        user = (
            await db_session.execute(
                select(models.User)
                .where(models.User.email == email)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert user.permissions_uuid is None

    @pytest.mark.asyncio
    async def test_an_unknown_user_is_reported(self, cli):
        status, _, err = await cli("user", "reset-password", "nobody@example.com")

        assert status == 1
        assert err.strip() == "✗ Error (404): User nobody@example.com not found"


class TestDataBackends:
    @pytest.mark.asyncio
    async def test_a_data_backend_is_added_listed_and_deleted(self, cli, tmp_path):
        entity_uuid = await _entity(cli, tmp_path)

        status, _, err = await cli(
            "data-backend", "add", entity_uuid, "--name", "prices",
            "--url", "https://prices.example.com", "--header", "X-Key:secret:headers",
        )  # fmt: skip
        assert status == 0, err
        status, out, _ = await cli("data-backend", "list", entity_uuid, "--json")
        [backend] = json.loads(out)
        assert (backend["name"], backend["url"]) == (
            "prices",
            "https://prices.example.com/",
        )
        assert backend["endpointHeaders"][0]["key"] == "X-Key"

        status, _, err = await cli(
            "data-backend", "add", entity_uuid, "--name", "bad",
            "--url", "https://bad.example.com", "--header", "X-Key:secret:nowhere",
        )  # fmt: skip
        assert status == 1
        assert err.startswith("✗ Error:")

        status, out, _ = await cli(
            "data-backend", "delete", entity_uuid, "--name", "prices"
        )
        assert (status, out.strip()) == (
            0,
            f"✓ Data backend 'prices' deleted from entity {entity_uuid}",
        )
        status, out, _ = await cli("data-backend", "list", entity_uuid)
        assert out.strip() == "No data backends found"


class TestProvisioning:
    @pytest.mark.asyncio
    async def test_an_entity_with_its_admins_and_users_in_one_go(self, cli, tmp_path):
        admin, member = (f"cli-{uuid4().hex[:8]}@example.com" for _ in range(2))
        cli.created["emails"] += [admin, member]
        person = {"first_name": "Cli", "last_name": "Person"}
        config = tmp_path / "provision.json"
        config.write_text(
            json.dumps(
                {
                    "entity": {
                        "name": f"CLI provisioned {uuid4().hex[:8]}",
                        "admin_email": admin,
                    },
                    "admins": [{"email": admin, **person}],
                    "users": [{"email": member, **person}],
                }
            )
        )
        assert (await cli("provision", "check", "--config", str(config)))[0] == 0

        status, out, err = await cli(
            "provision", "apply", "--config", str(config), "--json"
        )

        assert status == 0, err
        results = json.loads(out)
        cli.created["entities"].append(results["entity"]["entity_uuid"])
        assert [a["email"] for a in results["admins"]] == [admin]
        assert [u["email"] for u in results["users"]] == [member]
        assert results["failed"] == []
        assert all(
            "/reset-password#" in p["link"] for p in results["admins"] + results["users"]
        )

    @pytest.mark.asyncio
    async def test_an_incomplete_config_is_refused(self, cli, tmp_path):
        config = tmp_path / "incomplete.json"
        config.write_text(
            json.dumps({"entity": {"name": "x"}, "users": [{"email": "a@b.c"}]})
        )

        status, out, _ = await cli("provision", "check", "--config", str(config))

        assert status == 1
        assert "Entity missing required field: admin_email" in out
        assert "User (users #0) missing field: first_name" in out


@pytest.fixture
async def plugin_cli(cli, plugins_dir, db_session):
    cli.roles = []  # type: ignore[attr-defined]
    yield cli
    await db_session.execute(
        delete(models.RoleWidgetPlugin).where(models.RoleWidgetPlugin.role_uuid.in_(cli.roles))
    )
    await db_session.execute(
        delete(models.AuditEntityRolesPermissions).where(
            models.AuditEntityRolesPermissions.role_uuid.in_(cli.roles)
        )
    )
    await db_session.execute(delete(models.Role).where(models.Role.uuid.in_(cli.roles)))
    await db_session.execute(delete(models.WidgetPlugin))
    await db_session.commit()


async def _approved(plugin_cli, plugins_dir, data=None) -> None:
    write_package(plugins_dir, data)
    assert (await plugin_cli("plugin", "rescan"))[0] == 0
    status, _, err = await plugin_cli(
        "plugin", "approve", "test-chart", "1.0.0", "--acknowledge"
    )
    assert status == 0, err


class TestWidgetPlugins:
    @pytest.mark.asyncio
    async def test_a_version_is_reviewed_then_approved(self, plugin_cli, plugins_dir):
        write_package(plugins_dir)

        status, out, _ = await plugin_cli("plugin", "rescan", "--json")
        assert status == 0
        assert "test-chart" in json.dumps(json.loads(out))

        status, out, err = await plugin_cli("plugin", "approve", "test-chart", "1.0.0")
        assert status == 1
        assert "+ " in out and "Nothing approved" in err

        status, out, _ = await plugin_cli(
            "plugin", "approve", "test-chart", "1.0.0", "--acknowledge"
        )
        assert status == 0
        assert "✓ test-chart 1.0.0 approved and active" in out

        status, out, _ = await plugin_cli("plugin", "list")
        assert (status, out.split(" | ")[:3]) == (0, ["test-chart", "enabled", "active 1.0.0"])

    @pytest.mark.asyncio
    async def test_approving_is_one_action(self, plugin_cli, plugins_dir, monkeypatch):
        write_package(plugins_dir)
        await plugin_cli("plugin", "rescan")
        actions = []
        run = workspace_admin.run

        async def counted(action):
            actions.append(action)
            return await run(action)

        monkeypatch.setattr(workspace_admin, "run", counted)
        status, _, err = await plugin_cli("plugin", "approve", "test-chart", "1.0.0", "--acknowledge")

        assert status == 0, err
        assert len(actions) == 1

    @pytest.mark.asyncio
    async def test_a_digest_that_differs_stops_the_approval(self, plugin_cli, plugins_dir):
        write_package(plugins_dir)
        await plugin_cli("plugin", "rescan")

        status, _, err = await plugin_cli(
            "plugin", "approve", "test-chart", "1.0.0", "--acknowledge", "--digest", "sha256-x"
        )

        assert status == 1
        assert "not the ones you checked" in err

    @pytest.mark.asyncio
    async def test_an_entity_enables_it_and_a_role_grants_it(
        self, plugin_cli, plugins_dir, db_session, tmp_path
    ):
        await _approved(plugin_cli, plugins_dir)
        entity = UUID(await _entity(plugin_cli, tmp_path))
        role = models.Role(uuid=uuid4(), name="CLI plugin users", description="", entity_uuid=entity)
        db_session.add(role)
        await db_session.commit()
        plugin_cli.roles.append(role.uuid)

        status, out, _ = await plugin_cli("plugin", "enable", "test-chart", "--entity", str(entity))
        assert (status, out.strip()) == (0, f"✓ test-chart enabled in organization {entity}")
        status, out, _ = await plugin_cli("plugin", "grant", "test-chart", "--role", str(role.uuid))
        assert (status, out.strip()) == (
            0,
            f"✓ test-chart (every widget) granted to role {role.uuid}",
        )
        grants = (
            await db_session.execute(
                select(models.RoleWidgetPlugin.widget_id).where(
                    models.RoleWidgetPlugin.role_uuid == role.uuid
                )
            )
        ).scalars().all()
        assert grants == ["*"]

        status, out, _ = await plugin_cli("plugin", "show", "test-chart", "--json")
        shown = json.loads(out)
        assert [e["entity_uuid"] for e in shown["entities"] if e["enabled"]] == [str(entity)]

        assert (await plugin_cli("plugin", "ungrant", "test-chart", "--role", str(role.uuid)))[0] == 0
        assert (await plugin_cli("plugin", "disable", "test-chart", "--all"))[0] == 0
        status, out, _ = await plugin_cli("plugin", "show", "test-chart", "--json")
        assert [e for e in json.loads(out)["entities"] if e["enabled"]] == []

    @pytest.mark.asyncio
    async def test_revoke_and_restore(self, plugin_cli, plugins_dir):
        await _approved(plugin_cli, plugins_dir)

        assert (await plugin_cli("plugin", "revoke", "test-chart"))[1].strip() == "✓ test-chart revoked"
        status, out, _ = await plugin_cli("plugin", "show", "test-chart", "--json")
        assert json.loads(out)["status"] == "revoked"
        assert (await plugin_cli("plugin", "restore", "test-chart"))[1].strip() == "✓ test-chart restored"

    @pytest.mark.asyncio
    async def test_a_secret_is_read_from_standard_input_and_never_shown(
        self, plugin_cli, plugins_dir, db_session, monkeypatch
    ):
        write_package(plugins_dir, backend_manifest())
        await plugin_cli("plugin", "rescan")
        monkeypatch.setattr(sys, "stdin", io.StringIO("cli-secret-value\n"))

        status, out, err = await plugin_cli("plugin", "secret", "set", "test-chart", "api_key")

        assert (status, out.strip()) == (0, "✓ Secret api_key of test-chart set")
        [row] = (await db_session.execute(select(models.WidgetPluginSecret))).scalars().all()
        assert row.value == {"value": "cli-secret-value"}
        status, out, _ = await plugin_cli("plugin", "show", "test-chart")
        assert "cli-secret-value" not in out + err
        assert "Secret api_key: set at" in out

        assert (await plugin_cli("plugin", "secret", "clear", "test-chart", "api_key"))[0] == 0
        assert (await db_session.execute(select(models.WidgetPluginSecret))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_a_refusal_says_why(self, plugin_cli):
        status, _, err = await plugin_cli("plugin", "show", "no-such-plugin")

        assert status == 1
        assert err.startswith("✗ Error (404)")
