import os
import secrets
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENVIRONMENT = HERE / ".env"
PLUGIN_URL = HERE / "secrets" / "workspace" / "sql-explorer" / "postgres_url"


def write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(text)


def main() -> None:
    if ENVIRONMENT.exists() and PLUGIN_URL.exists():
        print("The credentials already exist.")
        return
    admin = secrets.token_urlsafe(32)
    reader = secrets.token_urlsafe(32)
    write_private(ENVIRONMENT, f"POSTGRES_PASSWORD={admin}\nEXPLORER_PASSWORD={reader}\n")
    write_private(PLUGIN_URL, f"postgresql://explorer:{reader}@postgres:5432/explorer")
    print("Wrote .env for Compose and secrets/workspace/sql-explorer/postgres_url for the plugin.")


if __name__ == "__main__":
    main()
