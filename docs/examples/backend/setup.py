import os
import secrets
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENVIRONMENT = HERE / ".env"
PLUGIN_URLS = [HERE / "secrets" / "workspace" / plugin / "postgres_url" for plugin in ("sql-explorer", "ag-grid")]


def write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(text)


def main() -> None:
    if ENVIRONMENT.exists() and all(path.exists() for path in PLUGIN_URLS):
        print("The credentials already exist.")
        return
    admin = secrets.token_urlsafe(32)
    reader = secrets.token_urlsafe(32)
    write_private(ENVIRONMENT, f"POSTGRES_PASSWORD={admin}\nEXPLORER_PASSWORD={reader}\n")
    for path in PLUGIN_URLS:
        write_private(path, f"postgresql://explorer:{reader}@postgres:5432/explorer")
    print("Wrote .env for Compose and secrets/workspace/<plugin>/postgres_url for each plugin.")


if __name__ == "__main__":
    main()
