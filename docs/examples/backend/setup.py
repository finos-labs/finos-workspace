import os
import secrets
from pathlib import Path

SECRETS = Path(__file__).resolve().parent / "secrets"


def secret(path: Path, make) -> str:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(make(), encoding="utf-8")
        os.chmod(path, 0o644)
    return path.read_text(encoding="utf-8").strip()


def main() -> None:
    SECRETS.mkdir(mode=0o700, exist_ok=True)
    os.chmod(SECRETS, 0o700)
    secret(SECRETS / "postgres_password", lambda: secrets.token_urlsafe(32))
    password = secret(SECRETS / "explorer_password", lambda: secrets.token_urlsafe(32))
    url = SECRETS / "workspace" / "sql-explorer" / "postgres_url"
    secret(url, lambda: f"postgresql://explorer:{password}@postgres:5432/explorer")
    print(f"secrets in {SECRETS}")
    print(f"the plugin's postgres_url secret: {url}")


if __name__ == "__main__":
    main()
