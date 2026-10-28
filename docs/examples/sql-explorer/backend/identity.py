import base64
import hashlib
import json
import os
from pathlib import Path

PROTOCOL = 1

PACKAGE = Path(os.environ.get("SQL_EXPLORER_PACKAGE") or Path(__file__).resolve().parent.parent)


def version_digest(root: Path) -> str:
    files = sorted((path.relative_to(root).as_posix(), path) for path in root.rglob("*") if path.is_file())
    lines = b"".join(f"{name}\0{hashlib.sha256(path.read_bytes()).hexdigest()}\n".encode() for name, path in files)
    return "sha256-" + base64.urlsafe_b64encode(hashlib.sha256(lines).digest()).decode().rstrip("=")


def identity(root: Path = PACKAGE) -> dict:
    manifest = json.loads((root / "plugin.json").read_text(encoding="utf-8"))
    return {
        "plugin": manifest["id"],
        "version": manifest["version"],
        "digest": version_digest(root),
        "protocol": PROTOCOL,
    }
