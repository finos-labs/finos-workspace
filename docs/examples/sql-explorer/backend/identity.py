"""What this backend answers to Workspace's identity check (GET /.workspace/identity).

The plugin, its version and the digest of the package this process runs from. The digest
is computed from the files at start, as Workspace computes a version's digest: the
SHA-256, unpadded base64url, of the sorted lines "<path>\\0<sha256 hex>\\n" of every file.
A file that differs from the approved version's changes it, and Workspace then sends
this backend nothing.
"""

import base64
import hashlib
import json
import os
from pathlib import Path

PROTOCOL = 1

# The package's directory: where the image put it, or beside this file
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
