"""The admin CLI: entities, entity types, users and data backends, from inside the API
container, where it works on the database itself. It sends no request to the API.

    docker compose exec api python -m scripts.workspace_admin <resource> <action>
    docker exec workspace workspace-admin <resource> <action>          # Lite

It does what the superuser's routes do (``routers/administration.py``) and prints the
outcome; ``--json`` prints it as JSON. A refused action prints why and exits with 1.
"""

import argparse
import asyncio
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
from routers import administration
from scripts import export_user_data
from utilities.log_helpers import obfuscate_secrets, stdoutSink

# Every entity has one permission map per user type; --role names the type
PERMISSION_MAPS = {
    "admin": models.ADMIN_TYPE,
    "developer": models.DEVELOPER_TYPE,
    "user": models.USER_TYPE,
}


def say(text: str = "", *, error: bool = False) -> None:
    """A line for whoever runs the CLI: the outcome on stdout, a refusal on stderr. The
    app's stdout is a log, which masks the value of any setting it would show
    (utilities/log_helpers.py) and would hide a link's address; the CLI's lines go out as
    they are."""
    stream = sys.stderr if error else sys.stdout
    (sys.__stdout__ if isinstance(stream, stdoutSink) else stream).write(f"{text}\n")


class Refused(Exception):
    """An action the CLI does not carry out, and why."""


async def run(action: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    """The outcome of an action on a database session of its own."""
    async with aclosing(aget_write_db()) as sessions:
        async for db in sessions:
            return await action(db)
    raise Refused("Could not open a database session")


def perform(action: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    """Carries out an action; a refusal is printed and the CLI exits with 1."""
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
    """A value of nested dicts by dotted path, or N/A."""
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
    """One page of a query's rows, each made an item, as the routes page them."""
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
    """The map of the user type `role` names, of the entity."""
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
    """An entity of a config file, which names its type `entity_type_uuid`."""
    data = dict(data)
    if "entity_type_uuid" in data and "entity_code" not in data:
        data["entity_code"] = data.pop("entity_type_uuid")
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


# --- Entities -------------------------------------------------------------------------


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
            f"{i['uuid']} | {get_val(i, 'entity_type.code')} | {i['name']} | "
            f"{get_val(i, 'entity_type.entity_type')} | "
            f"Sharing: {'on' if i.get('sharing_enabled') else 'off'}"
        ),
    )


def entity_sample(args: argparse.Namespace) -> None:
    say(
        json.dumps(
            {
                "name": "string (Required) - the name of the organization",
                "entity_type_uuid": "UUID (Required) - the entity type (entity-type list)",
                "email": "email (Required) - General contact email for the entity",
                "admin_email": "email (Required) - Email of the primary admin",
                "company_type": "string (Required) - e.g., 'Investment Firm'",
                "organization_size": "string (Required) - e.g., '10-50'",
                "aum": "integer (Required) - Assets Under Management",
                "country": "string (Required) - ISO country code or name",
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
        ("Code", "entity_type.code"),
        ("Type", "entity_type.entity_type"),
        ("Email", "email"),
        ("Country", "country"),
        ("Sharing enabled", "sharing_enabled"),
    ]
    render_record(entity, fields, args.json)


async def update_entity(
    db: AsyncSession, entity_uuid: UUID, changes: dict[str, Any]
) -> None:
    """The entity with the given fields changed and the others as they are."""
    current = await entity_by_uuid(db, entity_uuid)
    values = {
        key: current.get(key)
        for key in schemas.EntityBase.model_fields
        if key != "entity_code"
    }
    values["entity_code"] = str(current["entity_type"]["uuid"])
    if "entity_type_uuid" in changes and "entity_code" not in changes:
        changes = {**changes, "entity_code": changes["entity_type_uuid"]}
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


# --- Entity types ---------------------------------------------------------------------


async def create_entity_type(db: AsyncSession, name: str, code: str) -> UUID:
    await administration.create_entity_type(
        db,
        schemas.EntityTypeCreate(
            entity_type=name, code=code, active=True, permission_hierarchy=0
        ),
    )
    query = select(models.EntityType.uuid).where(models.EntityType.code == code)
    return (await db.execute(query)).scalar_one()


def entity_type_create(args: argparse.Namespace) -> None:
    type_uuid = perform(lambda db: create_entity_type(db, args.name, args.code))
    if args.json:
        print_json({"uuid": type_uuid})
    else:
        say(f"✓ Entity type created: {type_uuid}")


def entity_type_list(args: argparse.Namespace) -> None:
    page = perform(
        lambda db: page_of(
            db,
            administration.entity_types_query(),
            args.page,
            args.size,
            lambda row: dict(row._mapping),
        )
    )
    render_page(
        page,
        args.json,
        lambda i: (
            f"{i['uuid']} | {i['code']} | {i['entity_type']} | "
            f"Active: {i.get('active', False)} | Level: {i.get('permission_hierarchy', 0)}"
        ),
    )


# --- Users ----------------------------------------------------------------------------


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


def print_import_instructions(archive: Path, email: str, with_files: bool) -> None:
    """The steps for the person receiving the archive. The archive's README.md has them
    too, but whoever passes the file on should not have to unzip it to find them."""
    name = archive.name
    say("-" * 72)
    say(f"  SEND THIS TO {email}")
    say("-" * 72)
    say(f"""
  Your Workspace data is in {name}.

  To load it into Lite:

    1. Start Lite with the folder holding this file mounted:

       docker run -d --name workspace -p 3000:3000 -p 8000:8000 \\
           -v workspace-data:/data \\
           -v /path/to/the/folder:/import \\
           lite

    2. Import it. It asks for the export key, which reaches you separately:

       docker exec -it workspace workspace-import /import/{name}

    3. Set the administrator's password and sign in at http://localhost:3000

       docker exec -it workspace credentials

    4. As the administrator, open Users, then {email}, then Reset password, and set the
       account's password with the link. Your old Workspace password does not carry
       over -- it was never exported.

  Notes:""")
    if with_files:
        say(
            "    - Your uploaded files are in the archive's files/ folder. They are\n"
            "      NOT loaded into Lite, so unzip and keep them somewhere safe."
        )
    else:
        say(
            "    - This archive does not include your uploaded files, only the\n"
            "      record of them. Ask for an export with files if you need them."
        )
    say(
        "    - The credentials in the archive are encrypted with the export key.\n"
        "      The rest is not: keep it private and delete it once imported."
    )
    say()
    say("-" * 72)


def user_export(args: argparse.Namespace) -> None:
    try:
        result = asyncio.run(
            export_user_data.export_user(
                args.email,
                Path(args.out),
                include_history=args.include_history,
                with_files=args.with_files,
            )
        )
    except export_user_data.ExportError as exc:
        say(f"✗ Error: {exc}", error=True)
        sys.exit(1)

    size = result.archive.stat().st_size
    if args.json:
        print_json(
            {"path": str(result.archive), "bytes": size, "export_key": result.export_key}
        )
        return
    say(f"✓ Exported {args.email} to {result.archive} ({size / 1024:.0f} KB)")
    say()
    # Printed for whoever runs the CLI, never logged: the import needs it, and it is shown once
    say(f"  Export key (shown once, stored nowhere): {result.export_key}")
    say("  The archive's credentials are sealed with it. Send it to the person")
    say("  importing the archive separately from the file.")
    say()
    print_import_instructions(result.archive, args.email, with_files=args.with_files)


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


# --- Data backends --------------------------------------------------------------------


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


# --- Provisioning ---------------------------------------------------------------------

REQUIRED_ENTITY_FIELDS = (
    "name",
    "entity_type_uuid",
    "email",
    "company_type",
    "organization_size",
    "aum",
    "country",
    "admin_email",
)


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
                    "entity_type_uuid": "<UUID of Entity Type>",
                    "email": "<contact-email>",
                    "company_type": "Investment Firm",
                    "organization_size": "10-50",
                    "aum": 10000000,
                    "country": "USA",
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
    """The entity, then its admins and users; a user who cannot be created is reported."""
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


# --- Command line ---------------------------------------------------------------------


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


def _entity_type_commands(resources) -> None:
    entity_type = resources.add_parser("entity-type", help="Manage entity definitions")
    type_actions = entity_type.add_subparsers(dest="verb", required=True, help="Action")
    sub = _action(type_actions, "create", entity_type_create, "Define a new entity type")
    sub.add_argument("--name", required=True, help="Display name for the entity type")
    sub.add_argument("--code", required=True, help="Internal code identifier")
    _paged(_action(type_actions, "list", entity_type_list, "List available entity types"))


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
    sub = _action(
        user_actions, "export", user_export, "Write a user's data to a portable archive"
    )
    sub.add_argument("email", help="Email address of the account to export")
    sub.add_argument(
        "--out",
        default="./exports",
        help="Directory to write the archive into (default: ./exports)",
    )
    sub.add_argument(
        "--include-history",
        action="store_true",
        help="Include dashboard version history (much larger archive)",
    )
    sub.add_argument(
        "--with-files",
        action="store_true",
        help="Put the account's uploaded files into the archive (slow)",
    )
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


def parser() -> argparse.ArgumentParser:
    main_parser = argparse.ArgumentParser(
        prog="workspace-admin",
        description="Manage entities, users and data backends, from inside the API container.",
        fromfile_prefix_chars="@",
    )
    resources = main_parser.add_subparsers(
        dest="noun", required=True, help="Resource to manage"
    )
    for commands in (
        _entity_commands,
        _entity_type_commands,
        _user_commands,
        _data_backend_commands,
        _provision_commands,
    ):
        commands(resources)
    return main_parser


def log_to_stderr() -> None:
    """The app logs to stdout, the container's log (utilities/log_helpers.py). The CLI keeps
    stdout for the outcome, which --json makes JSON, and writes the app's warnings and
    errors to stderr, redacted as the app's log is."""
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
