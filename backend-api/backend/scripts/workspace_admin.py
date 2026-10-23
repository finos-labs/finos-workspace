import argparse
import asyncio
import getpass
import inspect
import json
import sys
from collections.abc import Awaitable, Callable
from contextlib import aclosing
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from loguru import logger
from pydantic import ValidationError
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import models, schemas
from api.database import aget_write_db
from api.widget_plugins import calls, service
from routers import administration
from routers.widget_plugins import OverridesBody
from utilities.log_helpers import obfuscate_secrets, stdoutSink

PERMISSION_MAPS = {
    "admin": models.ADMIN_TYPE,
    "developer": models.DEVELOPER_TYPE,
    "user": models.USER_TYPE,
}


def say(text: str = "", *, error: bool = False) -> None:
    stream = sys.stderr if error else sys.stdout
    (sys.__stdout__ if isinstance(stream, stdoutSink) else stream).write(f"{text}\n")


class Refused(Exception):
    ...


async def run(action: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    async with aclosing(aget_write_db()) as sessions:
        async for db in sessions:
            return await action(db)
    raise Refused("Could not open a database session")


def perform(action: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    try:
        return asyncio.run(run(action))
    except HTTPException as exc:
        say(f"✗ Error ({exc.status_code}): {exc.detail}", error=True)
    except (Refused, ValidationError, ValueError, OSError) as exc:
        say(f"✗ Error: {exc}", error=True)
    sys.exit(1)


def print_json(data: Any) -> None:
    say(json.dumps(jsonable_encoder(data, by_alias=True), indent=2))


def get_config_json(path: str) -> dict[str, Any]:
    file_path = Path(path).resolve()
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {path}")
    return json.loads(file_path.read_text(encoding="utf-8"))


def get_val(data: dict[str, Any], path: str) -> str:
    curr: Any = data
    for part in path.split("."):
        if not isinstance(curr, dict):
            return "N/A"
        curr = curr.get(part, {})
    return str(curr) if curr is not None and curr != {} else "N/A"


def render_record(
    data: dict[str, Any], fields: list[tuple[str, str]], json_mode: bool
) -> None:
    if json_mode:
        print_json(data)
        return
    width = max(len(label) for label, _ in fields)
    for label, path in fields:
        say(f"{label.ljust(width)} : {get_val(data, path)}")


def render_page(page: dict[str, Any], json_mode: bool, line: Callable[[dict], str]) -> None:
    if json_mode:
        print_json(page)
        return
    if not page["items"]:
        say("No items found")
        return
    for item in page["items"]:
        say(line(item))


async def page_of(
    db: AsyncSession, query: Select, page: int, size: int, item: Callable[[Any], Any]
) -> dict[str, Any]:
    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    rows = (await db.execute(query.limit(size).offset((page - 1) * size))).all()
    items = []
    for row in rows:
        value = item(row)
        items.append(jsonable_encoder(await value if inspect.isawaitable(value) else value))
    return {
        "items": items,
        "total": total,
        "page": page,
        "size": size,
        "pages": -(-total // size),
    }


async def user_by_email(db: AsyncSession, email: str) -> models.User:
    query = select(models.User).where(
        models.User.email == email, models.User.deleted.is_(False)
    )
    if (user := (await db.execute(query)).scalar_one_or_none()) is None:
        raise HTTPException(404, detail=f"User {email} not found")
    return user


async def permission_map(db: AsyncSession, entity_uuid: UUID, role: str) -> UUID:
    user_type = PERMISSION_MAPS[role.lower()]
    query = select(models.PermissionsEntityMap.uuid).where(
        models.PermissionsEntityMap.entity_uuid == entity_uuid,
        models.PermissionsEntityMap.name == user_type,
    )
    if (map_uuid := (await db.execute(query)).scalar_one_or_none()) is None:
        raise HTTPException(
            404, detail=f"Permission map '{user_type}' not found for entity {entity_uuid}"
        )
    return map_uuid


async def entity_by_uuid(db: AsyncSession, entity_uuid: UUID) -> dict[str, Any]:
    query = administration.entities_query().where(models.Entity.uuid == entity_uuid)
    if (row := (await db.execute(query)).first()) is None:
        raise HTTPException(404, detail=f"Entity {entity_uuid} not found")
    return jsonable_encoder(administration.entity_return(row))


def entity_post(data: dict[str, Any]) -> schemas.EntityPost:
    return schemas.EntityPost(**data)


async def create_entity(db: AsyncSession, entity: schemas.EntityPost) -> UUID:
    answer = await administration.create_entity(db, entity)
    await administration.notify_entity_created(entity)
    return answer.entity_uuid


async def create_user(
    db: AsyncSession,
    entity_uuid: UUID,
    email: str,
    first_name: str,
    last_name: str,
    role: str,
) -> dict[str, Any]:
    user = schemas.UserCreateAdmin(
        email=email,
        permissions_uuid=await permission_map(db, entity_uuid, role),
        first_name=first_name,
        last_name=last_name,
    )
    link = await administration.create_user(db, user, entity_uuid)
    return {**jsonable_encoder(link), "email": email, "role": role}


def print_link(email: str, answer: dict[str, Any], json_mode: bool, done: str) -> None:
    if json_mode:
        print_json(answer)
        return
    say(
        f"✓ {done} Give {email} this link to set their password. It works once, until {answer['expires_at']}:"
    )
    say(f"  {answer['link']}")


def entity_create(args: argparse.Namespace) -> None:
    entity_uuid = perform(
        lambda db: create_entity(db, entity_post(get_config_json(args.config)))
    )
    if args.json:
        print_json({"entity_uuid": entity_uuid})
    else:
        say(f"✓ Entity created: {entity_uuid}")


def entity_list(args: argparse.Namespace) -> None:
    page = perform(
        lambda db: page_of(
            db,
            administration.entities_query(),
            args.page,
            args.size,
            administration.entity_return,
        )
    )
    render_page(
        page,
        args.json,
        lambda i: (
            f"{i['uuid']} | {i['name']} | "
            f"Sharing: {'on' if i.get('sharing_enabled') else 'off'}"
        ),
    )


def entity_sample(args: argparse.Namespace) -> None:
    say(
        json.dumps(
            {
                "name": "string (Required) - the name of the organization",
                "admin_email": "email (Required) - Email of the primary admin",
                "sharing_enabled": "boolean (Optional) - Whether the entity's roles may allow "
                "sharing dashboards and apps (default: true)",
            },
            indent=2,
        )
    )


def entity_show(args: argparse.Namespace) -> None:
    entity = perform(lambda db: entity_by_uuid(db, args.entity_uuid))
    fields = [
        ("Entity", "name"),
        ("UUID", "uuid"),
        ("Sharing enabled", "sharing_enabled"),
    ]
    render_record(entity, fields, args.json)


async def update_entity(
    db: AsyncSession, entity_uuid: UUID, changes: dict[str, Any]
) -> None:
    current = await entity_by_uuid(db, entity_uuid)
    values = {key: current.get(key) for key in schemas.EntityBase.model_fields}
    values.update({key: value for key, value in changes.items() if key in values})
    await administration.update_entity(db, entity_uuid, schemas.EntityBase(**values))


def entity_update(args: argparse.Namespace) -> None:
    perform(
        lambda db: update_entity(
            db,
            args.entity_uuid,
            json.loads(args.json_input)
            if args.json_input
            else get_config_json(args.config),
        )
    )
    if args.json:
        print_json({"success": True})
    else:
        say(f"✓ Entity {args.entity_uuid} updated")


def entity_delete(args: argparse.Namespace) -> None:
    perform(lambda db: administration.delete_entity(db, args.entity_uuid))
    if args.json:
        print_json({"success": True})
    else:
        say(f"✓ Entity {args.entity_uuid} deleted")


def user_create(args: argparse.Namespace) -> None:
    answer = perform(
        lambda db: create_user(
            db, args.entity_uuid, args.email, args.first_name, args.last_name, args.role
        )
    )
    print_link(args.email, answer, args.json, "User created.")


def user_list(args: argparse.Namespace) -> None:
    page = perform(
        lambda db: page_of(
            db,
            administration.users_query(args.email or ""),
            args.page,
            args.size,
            lambda row: administration.user_return(db, row),
        )
    )
    render_page(
        page,
        args.json,
        lambda i: (
            f"{i['uuid']} | {i['email']} | {get_val(i, 'permissions.name')} | "
            f"{get_val(i, 'permissions.entity.name')}"
        ),
    )


async def remove_user(db: AsyncSession, email: str) -> None:
    await administration.remove_from_entity(db, (await user_by_email(db, email)).uuid)


def user_delete(args: argparse.Namespace) -> None:
    perform(lambda db: remove_user(db, args.email))
    if args.json:
        print_json({"success": True})
    else:
        say(f"✓ User {args.email} deleted")


async def reset_password(db: AsyncSession, email: str) -> dict[str, Any]:
    return jsonable_encoder(
        await administration.reset_password(db, (await user_by_email(db, email)).uuid)
    )


def user_reset_password(args: argparse.Namespace) -> None:
    answer = perform(lambda db: reset_password(db, args.email))
    print_link(
        args.email,
        answer,
        args.json,
        f"Password reset; {args.email} is signed out everywhere.",
    )


async def move_user(db: AsyncSession, email: str, entity_uuid: UUID, role: str) -> None:
    user = await user_by_email(db, email)
    await administration.move_user(
        db, user.uuid, await permission_map(db, entity_uuid, role)
    )


def user_move(args: argparse.Namespace) -> None:
    perform(lambda db: move_user(db, args.email, args.entity_uuid, args.role))
    if args.json:
        print_json({"success": True})
    else:
        say(
            f"✓ User {args.email} moved to entity {args.entity_uuid} as {PERMISSION_MAPS[args.role]}"
        )


def data_backend_add(args: argparse.Namespace) -> None:
    headers = []
    for header in args.headers or []:
        if ":" not in header:
            say(
                f"✗ Invalid header format: {header}. Use key:value or key:value:location",
                error=True,
            )
            sys.exit(1)
        parts = header.split(":", 2)
        headers.append(dict(zip(("key", "value", "location"), parts, strict=False)))
    perform(
        lambda db: administration.add_data_backend(
            db,
            args.entity_uuid,
            schemas.CreateApiSource(name=args.name, url=args.url, endpointHeaders=headers),
        )
    )
    if args.json:
        print_json({"success": True})
    else:
        say(f"✓ Data backend '{args.name}' added to entity {args.entity_uuid}")


def data_backend_delete(args: argparse.Namespace) -> None:
    perform(lambda db: administration.delete_data_backend(db, args.entity_uuid, args.name))
    if args.json:
        print_json({"success": True})
    else:
        say(f"✓ Data backend '{args.name}' deleted from entity {args.entity_uuid}")


async def list_data_backends(db: AsyncSession, entity_uuid: UUID) -> list[dict[str, Any]]:
    backends = await administration.data_backends(db, entity_uuid)
    return [
        jsonable_encoder(schemas.ReturnApiSource.model_validate(b), by_alias=True)
        for b in backends
    ]


def data_backend_list(args: argparse.Namespace) -> None:
    backends = perform(lambda db: list_data_backends(db, args.entity_uuid))
    if args.json:
        print_json(backends)
        return
    if not backends:
        say("No data backends found")
    for backend in backends:
        say(
            f"{backend.get('uuid', 'N/A')} | {backend.get('name', 'N/A')} | {backend.get('url', 'N/A')}"
        )


REQUIRED_ENTITY_FIELDS = ("name", "admin_email")


def config_errors(data: dict[str, Any]) -> list[str]:
    errors = []
    if "entity" not in data:
        errors.append("Missing top-level 'entity' object")
    else:
        errors += [
            f"Entity missing required field: {field}"
            for field in REQUIRED_ENTITY_FIELDS
            if field not in data["entity"]
        ]
    for group in ("admins", "users"):
        for idx, user in enumerate(data.get(group, [])):
            errors += [
                f"User ({group} #{idx}) missing field: {field}"
                for field in ("email", "first_name", "last_name")
                if field not in user
            ]
    return errors


def provision_check(args: argparse.Namespace) -> None:
    try:
        errors = config_errors(get_config_json(args.config))
    except json.JSONDecodeError as exc:
        errors = [f"Invalid JSON: {exc}"]
    except FileNotFoundError:
        errors = [f"File not found: {args.config}"]
    if args.json:
        print_json({"valid": not errors, **({"errors": errors} if errors else {})})
    elif errors:
        say("✗ Configuration invalid:")
        for error in errors:
            say(f"  - {error}")
    else:
        say("✓ Configuration is valid")
    if errors:
        sys.exit(1)


def provision_sample(args: argparse.Namespace) -> None:
    person = {"email": "<email>", "first_name": "<first name>", "last_name": "<last name>"}
    say(
        json.dumps(
            {
                "entity": {
                    "name": "<entity name>",
                    "sharing_enabled": True,
                    "admin_email": "<admin-email>",
                },
                "admins": [person],
                "users": [person],
            },
            indent=2,
        )
    )


async def provision(db: AsyncSession, config: dict[str, Any]) -> dict[str, Any]:
    entity_uuid = await create_entity(db, entity_post(config["entity"]))
    results: dict[str, Any] = {
        "entity": {"entity_uuid": entity_uuid},
        "admins": [],
        "users": [],
        "failed": [],
    }
    for group, role in (("admins", "admin"), ("users", "user")):
        for person in config.get(group, []):
            try:
                created = await create_user(
                    db,
                    entity_uuid,
                    person["email"],
                    person["first_name"],
                    person["last_name"],
                    role,
                )
                results[group].append(created)
            except (HTTPException, ValidationError) as exc:
                await db.rollback()
                detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
                results["failed"].append({"email": person["email"], "error": detail})
    return results


def provision_apply(args: argparse.Namespace) -> None:
    results = perform(lambda db: provision(db, get_config_json(args.config)))
    if args.json:
        print_json(results)
    else:
        say(f"✓ Entity created: {results['entity']['entity_uuid']}")
        for group in ("admins", "users"):
            for created in results[group]:
                print_link(
                    created["email"],
                    created,
                    False,
                    f"Created {created['role']} {created['email']}.",
                )
        for failed in results["failed"]:
            say(f"✗ Failed to create {failed['email']}: {failed['error']}", error=True)
        say("✓ Provisioning complete")


def _short_digest(digest: str | None) -> str:
    return f"{digest[:15]}…{digest[-6:]}" if digest else "-"


def _version_of(plugin: dict[str, Any], version: str) -> dict[str, Any]:
    for view in plugin["versions"]:
        if view["version"] == version:
            return view
    raise Refused(f"{plugin['plugin_id']} has no version {version}")


def _print_review(view: dict[str, Any]) -> list[str]:
    review = view.get("review") or []
    for item in review:
        mark = "+" if item.get("added") else "-" if item.get("removed") else " "
        risk = item.get("risk", "none")
        tag = f" [{risk} risk]" if risk != "none" else ""
        say(f"  {mark} {item['family']}: {item['label']}{tag}")
    for warning in view.get("findings", {}).get("warnings", []):
        say(f"  ! {warning}")
    return [item["key"] for item in review if item.get("added")]


def _backend_state(backend: dict[str, Any]) -> str:
    if not backend.get("registered"):
        return "not listed in WIDGET_PLUGIN_BACKENDS"
    identity = backend.get("identity")
    if not identity:
        return "registered, not checked yet"
    paused = " | paused after failures" if backend.get("breaker") == "open" else ""
    return f"identity {identity['state']} ({identity['detail']}){paused}"


def plugin_list(args: argparse.Namespace) -> None:
    listing = perform(service.platform_listing)
    if args.json:
        print_json(listing)
        return
    if not listing["enabled"]:
        say("Widget plugins are off: the API has no WIDGET_PLUGINS_DIR")
        return
    if not listing["plugins"]:
        say("No plugins found. Place a package in the plugins directory and rescan.")
        return
    for plugin in listing["plugins"]:
        versions = ", ".join(f"{v['version']} {v['state']}" for v in plugin["versions"])
        update = f" | update {plugin['update_available']}" if plugin["update_available"] else ""
        say(
            f"{plugin['plugin_id']} | {plugin['status']} | active "
            f"{plugin['active_version'] or '-'}{update} | "
            f"{plugin['enabled_entities']} organizations | {versions}"
        )


def _print_versions(plugin: dict[str, Any]) -> None:
    for view in plugin["versions"]:
        reason = f" ({view['blocked_reason']})" if view.get("blocked_reason") else ""
        say(
            f"  {view['version']} | {view['state']}{reason} | "
            f"{_short_digest(view.get('digest'))} | {view.get('pin_status')}"
        )
        for error in view.get("findings", {}).get("errors", []):
            say(f"    ✗ {error}")
        if view.get("review"):
            say(f"    To approve {view['version']} (+ added, - removed):")
            _print_review(view)


def _print_policy(plugin: dict[str, Any], active: dict[str, Any]) -> None:
    say("Effective policy:")
    for directive, sources in active["csp"]["effective"].items():
        say(f"  {directive} {' '.join(sources)}")
    server = active.get("server") or {}
    hosts = server.get("network", {}).get("approved", [])
    if hosts or server.get("proxies"):
        private = " (may resolve to private addresses)" if server.get("private") else ""
        say(f"Server network : {' '.join(hosts) or '-'}{private}")
        for proxy in server.get("proxies", []):
            say(f"  proxy {proxy['id']}: {proxy.get('method', 'GET')} {proxy['url']}")
    if server.get("backend"):
        routes = ", ".join(r["id"] for r in server["backend"].get("routes", []))
        say(f"Backend        : routes {routes or '-'} | {_backend_state(plugin['backend'])}")
        for source in server.get("data_sources", []):
            say(f"  data source {source['id']}: {source.get('purpose', '')}")
        if server.get("identity") == "pseudonymous":
            say("  learns an anonymous per-plugin id of the user")


def _print_plugin(plugin: dict[str, Any]) -> None:
    say(f"{plugin['name']} ({plugin['plugin_id']}) | {plugin['status']}")
    say(f"Active version : {plugin['active_version'] or '-'}")
    _print_versions(plugin)
    active = next(
        (v for v in plugin["versions"] if v["version"] == plugin["active_version"]), None
    )
    if active:
        _print_policy(plugin, active)
    for secret in plugin["secrets"]:
        if secret["source"] == "configuration":
            state = "set by the deployment's configuration"
        elif secret["set"]:
            state = f"set at {secret['set_at']}"
        else:
            state = "not set"
        problem = f" ✗ {secret['problem']}" if secret.get("problem") else ""
        stale = " (no version declares it)" if not secret.get("declared") else ""
        say(f"Secret {secret['name']}: {state}{problem}{stale}")
    enabled = [e for e in plugin["entities"] if e["enabled"]]
    say(f"Enabled for    : {len(enabled)} of {len(plugin['entities'])} organizations")
    for entity in enabled:
        say(f"  {entity['name'] or entity['entity_uuid']}")
    for event in plugin["events"][:10]:
        version = f" {event['version']}" if event.get("version") else ""
        say(f"  {event['created_date']} {event['action']}{version}")


def plugin_show(args: argparse.Namespace) -> None:
    plugin = perform(lambda db: service.platform_plugin(db, args.plugin_id))
    if args.json:
        print_json(plugin)
    else:
        _print_plugin(jsonable_encoder(plugin))


def plugin_rescan(args: argparse.Namespace) -> None:
    changes = perform(service.rescan)
    if args.json:
        print_json(changes)
        return
    changed = [(kind, items) for kind, items in changes.items() if isinstance(items, list) and items]
    if not changed:
        say("✓ Rescanned: no changes")
    for kind, items in changed:
        say(f"✓ {kind}: {', '.join(str(item) for item in items)}")


async def _approve(db: AsyncSession, args: argparse.Namespace) -> dict[str, Any]:
    plugin = jsonable_encoder(await service.platform_plugin(db, args.plugin_id))
    view = _version_of(plugin, args.version)
    if view["state"] not in {"discovered", "retired"}:
        raise Refused(f"{args.version} is {view['state']}; nothing to approve")
    if args.digest and args.digest != view["digest"]:
        raise Refused(
            f"The server has {view['digest']} for this version, not {args.digest}: "
            "the files are not the ones you checked"
        )
    say(f"{args.plugin_id} {args.version} | {view['digest']} | {view['pin_status']}")
    added = _print_review(view)
    if not args.acknowledge:
        raise Refused(
            f"Nothing approved. Run again with --acknowledge to accept the {len(added)} "
            "added requests above. Approving makes this the active version."
        )
    return await service.approve(
        db, args.plugin_id, args.version, digest=view["digest"], acknowledged=added, actor_uuid=None
    )


def plugin_approve(args: argparse.Namespace) -> None:
    approved = perform(lambda db: _approve(db, args))
    if args.json:
        print_json(approved)
    else:
        say(f"✓ {args.plugin_id} {args.version} approved and active")


def plugin_revoke(args: argparse.Namespace) -> None:
    revoke = args.verb == "revoke"
    outcome = perform(lambda db: service.set_status(db, args.plugin_id, revoke, None))
    if args.json:
        print_json(outcome)
    else:
        say(f"✓ {args.plugin_id} {'revoked' if revoke else 'restored'}")


async def _enable(db: AsyncSession, args: argparse.Namespace) -> dict[str, Any]:
    changes = {"enabled": args.verb == "enable"}
    if args.entity is None:
        count = await service.update_all_entities(db, args.plugin_id, changes, None)
        return {"success": True, "entities": count}
    if await db.get(models.Entity, args.entity) is None:
        raise Refused(f"No entity {args.entity}")
    await service.update_entity(db, args.entity, args.plugin_id, changes, None)
    return {"success": True}


def plugin_enable(args: argparse.Namespace) -> None:
    outcome = perform(lambda db: _enable(db, args))
    if args.json:
        print_json(outcome)
        return
    where = f"organization {args.entity}" if args.entity else f"{outcome['entities']} organizations"
    done = "enabled" if args.verb == "enable" else "disabled"
    say(f"✓ {args.plugin_id} {done} in {where}")


async def _grant(db: AsyncSession, args: argparse.Namespace) -> dict[str, Any]:
    role = (
        await db.execute(
            select(models.Role.uuid).where(
                models.Role.uuid == args.role, models.Role.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if role is None:
        raise Refused(f"No role {args.role}")
    grant = {"plugin_id": args.plugin_id, "widget_id": args.widget}
    grants = [g for g in await service.get_role_grants(db, role) if g != grant]
    if args.verb == "grant":
        grants.append(grant)
    await service.set_role_grants(db, role, grants)
    return {"success": True, "grants": grants}


def plugin_grant(args: argparse.Namespace) -> None:
    outcome = perform(lambda db: _grant(db, args))
    if args.json:
        print_json(outcome)
        return
    widget = "every widget" if args.widget == "*" else f"widget {args.widget}"
    done = "granted to" if args.verb == "grant" else "no longer granted to"
    say(f"✓ {args.plugin_id} ({widget}) {done} role {args.role}")


async def _override(db: AsyncSession, args: argparse.Namespace) -> dict[str, Any]:
    if args.clear == bool(args.csp_file or args.server_network):
        raise Refused("Give --csp-file and/or --server-network, or --clear alone")
    body = OverridesBody(
        csp=get_config_json(args.csp_file) if args.csp_file else None,
        server_network=args.server_network,
        confirmations=args.confirm or [],
    )
    return await service.set_overrides(
        db, args.plugin_id, body.csp, body.server_network, list(body.confirmations), None
    )


def plugin_override(args: argparse.Namespace) -> None:
    outcome = perform(lambda db: _override(db, args))
    if args.json:
        print_json(outcome)
    else:
        say(f"✓ Policy overrides of {args.plugin_id} {'cleared' if args.clear else 'set'}")


def _read_secret(name: str) -> str:
    if sys.stdin.isatty():
        return getpass.getpass(f"Value of {name}: ")
    return sys.stdin.read().removesuffix("\n").removesuffix("\r")


def plugin_secret(args: argparse.Namespace) -> None:
    if args.action == "set":
        value = _read_secret(args.name)
        if not value:
            say("✗ The value is empty", error=True)
            sys.exit(1)
        perform(lambda db: service.set_secret(db, args.plugin_id, args.name, value, None))
        done = "set"
    else:
        perform(lambda db: service.clear_secret(db, args.plugin_id, args.name, None))
        done = "cleared"
    if args.json:
        print_json({"success": True})
    else:
        say(f"✓ Secret {args.name} of {args.plugin_id} {done}")


def plugin_check_backend(args: argparse.Namespace) -> None:
    backend = perform(lambda db: calls.check_backend(db, args.plugin_id))
    if args.json:
        print_json(backend)
    else:
        say(f"{args.plugin_id} backend: {_backend_state(jsonable_encoder(backend))}")


def plugin_events(args: argparse.Namespace) -> None:
    events = jsonable_encoder(perform(lambda db: service.plugin_events(db, args.plugin_id)))
    if args.json:
        print_json(events)
        return
    for event in events:
        version = f" {event['version']}" if event.get("version") else ""
        entity = f" entity {event['entity_uuid']}" if event.get("entity_uuid") else ""
        say(f"{event['created_date']} | {event['action']}{version}{entity}")


def plugin_reports(args: argparse.Namespace) -> None:
    reports = jsonable_encoder(perform(lambda db: service.list_reports(db, args.plugin_id)))
    if args.json:
        print_json(reports)
        return
    if not reports:
        say("No blocked requests")
    for report in reports:
        say(
            f"{report['directive']} {report['origin']} | {report['count']}x | "
            f"{report['version']} | entity {report['entity_uuid']} | last {report['last_seen']}"
        )


def plugin_forget(args: argparse.Namespace) -> None:
    perform(lambda db: service.forget(db, args.plugin_id))
    if args.json:
        print_json({"success": True})
    else:
        say(f"✓ {args.plugin_id} forgotten, with its decisions, grants and secrets")


def _action(group, name: str, func: Callable, help_text: str, json_output: bool = True):
    sub = group.add_parser(name, help=help_text)
    if json_output:
        sub.add_argument("--json", action="store_true", help="Print the outcome as JSON")
    sub.set_defaults(func=func)
    return sub


def _paged(sub) -> None:
    sub.add_argument("--page", type=int, default=1, help="Page number (default: 1)")
    sub.add_argument("--size", type=int, default=100, help="Items per page (default: 100)")


def _entity_commands(resources) -> None:
    entity = resources.add_parser("entity", help="Manage organization entities")
    entity_actions = entity.add_subparsers(dest="verb", required=True, help="Action")
    sub = _action(entity_actions, "create", entity_create, "Create a new entity")
    sub.add_argument(
        "--config", "-c", required=True, help="Path to JSON config file with entity details"
    )
    _paged(_action(entity_actions, "list", entity_list, "List all entities"))
    _action(
        entity_actions,
        "sample",
        entity_sample,
        "Print a sample entity config",
        json_output=False,
    )
    sub = _action(entity_actions, "show", entity_show, "Show details of a specific entity")
    sub.add_argument("entity_uuid", type=UUID, help="UUID of the entity")
    sub = _action(entity_actions, "update", entity_update, "Update an existing entity")
    sub.add_argument("entity_uuid", type=UUID, help="UUID of the entity")
    fields = sub.add_mutually_exclusive_group(required=True)
    fields.add_argument(
        "--config", "-c", help="Path to JSON file containing fields to update"
    )
    fields.add_argument(
        "--data",
        "-d",
        dest="json_input",
        help="JSON string with fields to update (e.g. '{\"sharing_enabled\": true}')",
    )
    sub = _action(
        entity_actions, "delete", entity_delete, "Delete an entity that has no users"
    )
    sub.add_argument("entity_uuid", type=UUID, help="UUID of the entity")


def _user_commands(resources) -> None:
    user = resources.add_parser("user", help="Manage users within entities")
    user_actions = user.add_subparsers(dest="verb", required=True, help="Action")
    sub = _action(
        user_actions,
        "create",
        user_create,
        "Create a user in an entity and print the link that sets their password",
    )
    sub.add_argument("entity_uuid", type=UUID, help="UUID of the target entity")
    sub.add_argument("--email", required=True, help="User's email address")
    sub.add_argument("--first-name", required=True, help="User's first name")
    sub.add_argument("--last-name", required=True, help="User's last name")
    sub.add_argument(
        "--role",
        choices=list(PERMISSION_MAPS),
        default="user",
        help="User type (default: user)",
    )
    sub = _action(user_actions, "list", user_list, "List users (globally or filtered)")
    _paged(sub)
    sub.add_argument("--email", help="Only users whose email contains this")
    sub = _action(user_actions, "delete", user_delete, "Remove a user from their entity")
    sub.add_argument("email", help="Email address of the user to remove")
    sub = _action(
        user_actions,
        "reset-password",
        user_reset_password,
        "Reset a user's password and print the link that sets a new one",
    )
    sub.add_argument("email", help="Email address of the user")
    sub = _action(user_actions, "move", user_move, "Move a user to another entity")
    sub.add_argument(
        "--entity-uuid", type=UUID, required=True, help="UUID of the target entity"
    )
    sub.add_argument("--email", required=True, help="Email address of the user to move")
    sub.add_argument(
        "--role",
        choices=list(PERMISSION_MAPS),
        default="user",
        help="User type in the new entity (default: user)",
    )


def _data_backend_commands(resources) -> None:
    backend = resources.add_parser("data-backend", help="Manage entity data backends")
    backend_actions = backend.add_subparsers(dest="verb", required=True, help="Action")
    sub = _action(
        backend_actions, "add", data_backend_add, "Add a data backend to an entity"
    )
    sub.add_argument("entity_uuid", type=UUID, help="UUID of the target entity")
    sub.add_argument("--name", required=True, help="Name of the data backend")
    sub.add_argument("--url", required=True, help="URL of the data backend")
    sub.add_argument(
        "--header",
        dest="headers",
        action="append",
        help="Endpoint header as key:value or key:value:location (repeatable)",
    )
    sub = _action(
        backend_actions,
        "delete",
        data_backend_delete,
        "Remove a data backend from an entity",
    )
    sub.add_argument("entity_uuid", type=UUID, help="UUID of the target entity")
    sub.add_argument("--name", required=True, help="Name of the data backend to remove")
    sub = _action(
        backend_actions, "list", data_backend_list, "List data backends for an entity"
    )
    sub.add_argument("entity_uuid", type=UUID, help="UUID of the target entity")


def _provision_commands(resources) -> None:
    provisioning = resources.add_parser("provision", help="Bulk provisioning")
    provision_actions = provisioning.add_subparsers(
        dest="verb", required=True, help="Action"
    )
    sub = _action(
        provision_actions, "check", provision_check, "Validate a provisioning config file"
    )
    sub.add_argument("--config", "-c", required=True, help="Path to JSON config file")
    _action(
        provision_actions,
        "sample",
        provision_sample,
        "Print a sample provisioning config",
        json_output=False,
    )
    sub = _action(
        provision_actions,
        "apply",
        provision_apply,
        "Create the entity, admins and users of a config",
    )
    sub.add_argument(
        "--config", "-c", required=True, help="Path to JSON defining entity and users"
    )


def _plugin_commands(resources) -> None:  # noqa: PLR0915 - one parser per action
    plugin = resources.add_parser(
        "plugin",
        help="Review and enable widget plugins (packages are placed on the server, "
        "never installed from here)",
    )
    plugin_actions = plugin.add_subparsers(dest="verb", required=True, help="Action")

    def action(name: str, func: Callable, help_text: str, with_id: bool = True):
        sub = _action(plugin_actions, name, func, help_text)
        if with_id:
            sub.add_argument("plugin_id", help="The plugin's id")
        return sub

    action("list", plugin_list, "List discovered plugins and versions", with_id=False)
    action("rescan", plugin_rescan, "Read the plugins directory again", with_id=False)
    action(
        "show",
        plugin_show,
        "Show a plugin: versions, what approving accepts, policy, organizations, events",
    )
    sub = action("approve", plugin_approve, "Review a version and make it the active one")
    sub.add_argument("version", help="The version to approve")
    sub.add_argument(
        "--acknowledge",
        action="store_true",
        help="Accept every added request the review lists (without it, only the review is shown)",
    )
    sub.add_argument(
        "--digest",
        help="The version digest you checked with plugin_check; approval stops if the "
        "server's differs",
    )
    action("revoke", plugin_revoke, "Stop a plugin everywhere (kill switch)")
    action("restore", plugin_revoke, "Undo a revoke")
    for verb, help_text in (
        ("enable", "Enable the plugin for an organization, or for all"),
        ("disable", "Disable the plugin for an organization, or for all"),
    ):
        sub = action(verb, plugin_enable, help_text)
        target = sub.add_mutually_exclusive_group(required=True)
        target.add_argument("--entity", type=UUID, help="UUID of the organization (entity)")
        target.add_argument(
            "--all", dest="entity", action="store_const", const=None, help="Every organization"
        )
    for verb, help_text in (
        ("grant", "Grant a role a plugin's widgets: roles are the only way to a plugin"),
        ("ungrant", "Take a grant away from a role"),
    ):
        sub = action(verb, plugin_grant, help_text)
        sub.add_argument("--role", type=UUID, required=True, help="UUID of the role")
        sub.add_argument("--widget", default="*", help="One widget id (default: every widget)")
    sub = action(
        "override",
        plugin_override,
        "Replace the superuser's overrides: the CSP by directive and the server network",
    )
    sub.add_argument(
        "--csp-file",
        help='JSON file of directive to sources, e.g. {"connect-src": ["https://<host>"]}',
    )
    sub.add_argument(
        "--server-network",
        action="append",
        help="An https origin the server may call for the plugin's proxies, replacing the "
        "hosts it declares (repeatable)",
    )
    sub.add_argument("--clear", action="store_true", help="Remove the overrides")
    sub.add_argument(
        "--confirm",
        action="append",
        choices=["insecure-scheme", "private-host", "remote-script"],
        help="Confirm a dangerous source the overrides add (repeatable); private-host with "
        "--server-network also lets those hosts resolve to private addresses",
    )
    secret = plugin_actions.add_parser(
        "secret", help="Set or clear the value of a secret the plugin declares"
    )
    secret_actions = secret.add_subparsers(dest="action", required=True, help="Action")
    for name, help_text in (
        ("set", "Set the value: read without echo, or from standard input, never an argument"),
        ("clear", "Remove the value a superuser set"),
    ):
        sub = _action(secret_actions, name, plugin_secret, help_text)
        sub.add_argument("plugin_id", help="The plugin's id")
        sub.add_argument("name", help="The secret's name, as the plugin declares it")
    action(
        "check-backend",
        plugin_check_backend,
        "Ask the plugin's backend for its identity now (the deployer runs and lists it)",
    )
    action("events", plugin_events, "List the plugin's events")
    action("reports", plugin_reports, "List requests the plugin's policy blocked")
    action(
        "forget",
        plugin_forget,
        "Forget a plugin whose files are gone, with its decisions, grants and secrets",
    )


def parser() -> argparse.ArgumentParser:
    main_parser = argparse.ArgumentParser(
        prog="python -m scripts.workspace_admin",
        description="Manage entities, users, data backends and widget plugins, from inside "
        "the API container.",
        fromfile_prefix_chars="@",
    )
    resources = main_parser.add_subparsers(
        dest="noun", required=True, help="Resource to manage"
    )
    for commands in (
        _entity_commands,
        _user_commands,
        _data_backend_commands,
        _provision_commands,
        _plugin_commands,
    ):
        commands(resources)
    return main_parser


def log_to_stderr() -> None:
    logger.configure(
        handlers=[
            {
                "sink": lambda message: sys.stderr.write(obfuscate_secrets(str(message))),
                "level": "WARNING",
                "format": "{level}: {message}\n",
                "diagnose": False,
                "backtrace": False,
            }
        ]
    )


def main(argv: list[str] | None = None) -> None:
    args = parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    log_to_stderr()
    main()
