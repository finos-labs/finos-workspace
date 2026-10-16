"""Write what a fresh checkout needs to start with ``docker compose``.

``envs/.env`` holds the settings that compose hands to the API and the worker. It starts from
``envs/.env.example``, points the settings at the compose services and fills the secrets with
random values. ``scripts/cfgs/config.toml`` names the organization and the administrator that
the first start creates (``scripts.init_users`` reads it). No file holds the administrator's
password: ``scripts.init_users`` makes it up when it creates the account and prints it once,
in the log of compose's ``init`` service. ``user_create.json`` starts empty: compose mounts
it into the containers, and without a file on the host Docker would put a directory there.

    python -m scripts.create_local_env --admin-email <your-email>   # refuses to overwrite
    python -m scripts.create_local_env --admin-email <your-email> --force
    python -m scripts.create_local_env --admin-email <your-email> --config-only   # only the seed config

The web app is served on port 3000, the admin panel on port 3001 and the API on port 8000, as
in ``docker-compose.yml``. Only the standard library is needed.
"""

import argparse
import base64
import hashlib
import hmac
import json
import secrets
import sys
from pathlib import Path

ENVS = Path(__file__).resolve().parent.parent / "envs"
EXAMPLE = ENVS / ".env.example"
TARGET = ENVS / ".env"
SQLITE_EXAMPLE = ENVS / ".env.sqlite.example"
SQLITE_TARGET = ENVS / ".env.sqlite"
CONFIG = Path(__file__).resolve().parent / "cfgs" / "config.toml"
USER_CREATE = Path(__file__).resolve().parent.parent / "user_create.json"

WEB_URL = "http://localhost:3000"
API_URL = "http://localhost:8000"
# The browsers' origins the API serves: docker-compose.yml's web app and admin panel, the
# dev server of local/compose.yaml and the admin panel's `vite` dev server. To use the Excel
# add-in against the stack, add its https origin to BACKEND_CORS_ORIGINS in envs/.env.
BACKEND_CORS_ORIGINS = [
    WEB_URL,
    "http://localhost:3001",
    "http://localhost:1420",
    "http://localhost:5173",
]


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwt_hs256(payload: dict[str, str], secret: str) -> str:
    """A JWT signed with HS256, as ``jwt.encode`` writes it."""
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256)
    return f"{header}.{body}.{_b64(signature.digest())}"


def secrets_for(
    jwt_secret: str, aes_key: str, storage_secret: str
) -> dict[str, str]:
    """The settings that every kind of stack has to generate."""
    return {
        "JWT_SECRET": jwt_secret,
        "WORKSPACE_AES_KEY": aes_key,
        "WORKSPACE_AUTH_TOKEN": jwt_hs256(
            {"sub": "workspace", "auth": secrets.token_hex(16)}, jwt_secret
        ),
        "LOCAL_STORAGE_SECRET_KEY": storage_secret,
    }


def settings(
    jwt_secret: str, aes_key: str, storage_secret: str
) -> dict[str, str]:
    """What differs from ``.env.example`` for a stack run by ``docker compose``."""
    return {
        "DB_HOST": "mysql",
        "DB_NAME": "workspace",
        "REDIS_HOST": "redis",
        "STORAGE_PROVIDER": "folder",
        "MODE": "onprem",
        "FRONTENDURL": WEB_URL,
        "APPURL": WEB_URL,
        "SELFURL": API_URL,
        "BACKEND_CORS_ORIGINS": json.dumps(BACKEND_CORS_ORIGINS, separators=(",", ":")),
        **secrets_for(jwt_secret, aes_key, storage_secret),
    }


def seed_config(entity_name: str, email: str) -> str:
    """The TOML that ``scripts.init_users`` reads: one organization and its administrator."""
    return f"""\
[entity]
name = {json.dumps(entity_name)}
aum = 1000
company_type = "CORPORATION"
organization_size = "SMALL"
country = "DOM"

[[admins]]
email = {json.dumps(email)}
first_name = "Workspace"
last_name = "Administrator"
"""


def render(example: str, values: dict[str, str]) -> str:
    """The example with each of ``values`` set; keys that are not in it are appended."""
    lines = example.splitlines()
    remaining = dict(values)
    for index, line in enumerate(lines):
        key, sign, _ = line.partition("=")
        if sign and key in remaining:
            lines[index] = f"{key}={remaining.pop(key)}"
    lines += [f"{key}={value}" for key, value in remaining.items()]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write envs/.env and scripts/cfgs/config.toml for docker compose."
    )
    parser.add_argument(
        "--admin-email", required=True, help="Email address of the first administrator"
    )
    parser.add_argument("--entity-name", default="Workspace", help="Name of the organization")
    parser.add_argument(
        "--sqlite",
        action="store_true",
        help="Write envs/.env.sqlite (from .env.sqlite.example) instead of envs/.env",
    )
    parser.add_argument(
        "--config-only",
        action="store_true",
        help="Write only scripts/cfgs/config.toml and leave the environment file alone",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    args = parser.parse_args(argv)

    example, target = (SQLITE_EXAMPLE, SQLITE_TARGET) if args.sqlite else (EXAMPLE, TARGET)
    for path in (CONFIG,) if args.config_only else (target, CONFIG):
        if path.exists() and not args.force:
            sys.stderr.write(f"{path} exists; pass --force to replace it\n")
            return 1

    # 256 bits or more each; the API refuses shorter secrets
    generated = dict(
        jwt_secret=secrets.token_urlsafe(48),
        aes_key=secrets.token_urlsafe(32),
        storage_secret=secrets.token_urlsafe(32),
    )
    if not args.config_only:
        values = secrets_for(**generated) if args.sqlite else settings(**generated)
        target.write_text(render(example.read_text(), values))
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(seed_config(args.entity_name, args.admin_email))
    if not (args.config_only or args.sqlite) and not USER_CREATE.exists():
        USER_CREATE.write_text("{}\n")
    sys.stdout.write(
        f"Wrote {CONFIG if args.config_only else f'{target} and {CONFIG}'}\n"
        f"Sign in as {args.admin_email}. scripts.init_users creates the account on the first "
        "start and prints its password once; with docker compose it is in the log of the init "
        "service (docker compose logs init).\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
