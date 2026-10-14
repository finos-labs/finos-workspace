"""Discovery and verification of the plugins directory (docs/widget-plugins/DESIGN.md 4.3).

The directory holds ``<plugin-id>/<version>/`` packages. This module only reads it.
For every version it refuses symbolic links and paths outside the directory, applies
the caps, hashes every file, computes the version digest and the checksum, compares
them with the manifest and the deployer's pins, and validates the manifest.
"""

import base64
import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .manifest import PLUGIN_ID_PATTERN, VERSION_PATTERN, Manifest

MANIFEST_FILE = "plugin.json"
MAX_MANIFEST_BYTES = 256 * 1024
_FILE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_REMOTE_IMPORT = re.compile(rb"""(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s+)["'](?:https?:)?//""", re.IGNORECASE)
_DYNAMIC_CODE = re.compile(rb"\beval\s*\(|\bnew\s+Function\s*\(")


@dataclass
class FileInfo:
    size: int
    sha256: str  # hex
    mtime_ns: int


@dataclass
class DiscoveredVersion:
    """One ``<plugin-id>/<version>/`` directory as discovery found it."""

    plugin_id: str
    version: str
    path: str  # relative to the plugins directory
    files: dict[str, FileInfo] = field(default_factory=dict)
    digest: str | None = None
    checksum: str | None = None
    declared_checksum: str | None = None
    manifest: dict[str, Any] | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    pin_status: str = "unpinned"
    # What the first blocking finding is about: files, manifest, checksum or pin
    block_reason: str | None = None

    @property
    def blocked(self) -> bool:
        return bool(self.errors)

    def fail(self, reason: str, *messages: str) -> None:
        self.errors.extend(messages)
        self.block_reason = self.block_reason or reason

    def served_files(self) -> dict[str, dict[str, Any]]:
        """The files a browser may receive, with their sizes and hashes."""
        if self.manifest is None:
            return {}
        entry = self.manifest.get("entry", {})
        served = {entry.get("module"), *entry.get("styles", [])}
        if self.manifest.get("icon"):
            served.add(self.manifest["icon"])
        served |= {p for p in self.files if p.startswith("assets/")}
        return {
            p: {"size": self.files[p].size, "sha256": self.files[p].sha256}
            for p in sorted(p for p in served if p in self.files)
        }


@dataclass
class ScanResult:
    versions: list[DiscoveredVersion] = field(default_factory=list)
    # Paths that were not read at all, with the reason
    rejected: list[str] = field(default_factory=list)
    error: str | None = None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb", buffering=0) as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def listing_digest(files: dict[str, str]) -> str:
    """``sha256-<base64url>`` of the sorted ``<path>\\0<sha256 hex>\\n`` lines."""
    lines = b"".join(f"{path}\0{files[path]}\n".encode() for path in sorted(files))
    raw = hashlib.sha256(lines).digest()
    return "sha256-" + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def version_digest(files: dict[str, str]) -> str:
    """The version digest: every file of the version, plugin.json included."""
    return listing_digest(files)


def package_checksum(files: dict[str, str]) -> str:
    """The manifest's checksum: every file except plugin.json, so it can contain it."""
    return listing_digest({p: h for p, h in files.items() if p != MANIFEST_FILE})


def _walk(root: Path, version: DiscoveredVersion, max_files: int, max_bytes: int) -> None:
    """Hash every regular file under ``root``; refuse links, odd names and excess."""
    total = 0
    stack = [(root, "")]
    while stack:
        directory, prefix = stack.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                relative = f"{prefix}{entry.name}"
                if not _FILE_NAME.fullmatch(entry.name) or entry.name in {".", ".."}:
                    version.fail("files", f"{relative}: a file name that is not allowed")
                    continue
                info = entry.stat(follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode):
                    version.fail("files", f"{relative}: symbolic links are not allowed")
                    continue
                if stat.S_ISDIR(info.st_mode):
                    stack.append((Path(entry.path), f"{relative}/"))
                    continue
                if not stat.S_ISREG(info.st_mode):
                    version.fail("files", f"{relative}: not a regular file")
                    continue
                if len(version.files) >= max_files:
                    version.fail("files", f"more than {max_files} files")
                    return
                total += info.st_size
                if total > max_bytes:
                    version.fail("files", f"larger than {max_bytes} bytes in total")
                    return
                version.files[relative] = FileInfo(
                    size=info.st_size,
                    sha256=sha256_file(Path(entry.path)),
                    mtime_ns=info.st_mtime_ns,
                )


def _format_validation(error: ValidationError) -> list[str]:
    messages = []
    for issue in error.errors()[:20]:
        location = "/".join(str(p) for p in issue["loc"]) or "manifest"
        message = issue["msg"].removeprefix("Value error, ")
        messages.append(f"{location}: {message}")
    return messages


def inspect_version(  # noqa: PLR0911, PLR0912 - one return per blocking finding
    root: Path,
    plugin_id: str,
    version_name: str,
    *,
    pins: dict[str, str],
    require_pins: bool,
    max_files: int,
    max_bytes: int,
) -> DiscoveredVersion:
    """Verify one version directory. Errors block the version; warnings do not."""
    found = DiscoveredVersion(plugin_id=plugin_id, version=version_name, path=f"{plugin_id}/{version_name}")
    version_dir = root / plugin_id / version_name
    _walk(version_dir, found, max_files, max_bytes)
    if found.errors:
        return found

    hashes = {path: info.sha256 for path, info in found.files.items()}
    found.digest = version_digest(hashes)
    found.checksum = package_checksum(hashes)

    if MANIFEST_FILE not in found.files:
        found.fail("manifest", f"{MANIFEST_FILE} is missing")
        return found
    if found.files[MANIFEST_FILE].size > MAX_MANIFEST_BYTES:
        found.fail("manifest", f"{MANIFEST_FILE} is larger than {MAX_MANIFEST_BYTES} bytes")
        return found
    try:
        raw = json.loads((version_dir / MANIFEST_FILE).read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        found.fail("manifest", f"{MANIFEST_FILE} is not valid JSON: {exc}")
        return found
    if not isinstance(raw, dict):
        found.fail("manifest", f"{MANIFEST_FILE} must be an object")
        return found
    found.manifest = raw
    found.declared_checksum = raw.get("checksum") if isinstance(raw.get("checksum"), str) else None

    try:
        manifest = Manifest.model_validate(raw)
    except ValidationError as exc:
        found.fail("manifest", *_format_validation(exc))
        return found

    if manifest.id != plugin_id:
        found.fail("manifest", f"the manifest id {manifest.id!r} differs from its directory")
    if manifest.version != version_name:
        found.fail("manifest", f"the manifest version {manifest.version!r} differs from its directory")
    if manifest.checksum != found.checksum:
        found.fail(
            "checksum",
            f"the files do not match the manifest's checksum (declared {manifest.checksum}, computed {found.checksum})",
        )
    for path in sorted(manifest.served_paths()):
        if path not in found.files:
            found.fail("manifest", f"{path}: named by the manifest but missing")

    pin = pins.get(f"{plugin_id}@{version_name}")
    if pin is None:
        found.pin_status = "unpinned"
        if require_pins:
            found.fail("pin", "no pin, and WIDGET_PLUGINS_REQUIRE_PINS is on")
    elif pin == found.digest:
        found.pin_status = "pinned"
    else:
        found.pin_status = "mismatch"
        found.fail("pin", f"the version digest differs from its pin {pin}")

    entry_path = version_dir / manifest.entry.module
    if manifest.entry.module in found.files:
        code = entry_path.read_bytes()
        script_src = (manifest.csp or {}).get("script-src", [])
        if _REMOTE_IMPORT.search(code):
            found.warnings.append(
                "the entry imports from a URL, which the frame cannot load unless the CSP allows that origin"
            )
        if _DYNAMIC_CODE.search(code) and "'unsafe-eval'" not in script_src:
            found.warnings.append(
                "the entry appears to use eval or new Function, which the frame blocks without 'unsafe-eval'"
            )
    return found


def scan(
    plugins_dir: str | None,
    *,
    pins: dict[str, str] | None = None,
    require_pins: bool = False,
    max_files: int = 200,
    max_bytes: int = 64 * 1024 * 1024,
) -> ScanResult:
    """Read the plugins directory. Never writes to it."""
    result = ScanResult()
    if not plugins_dir:
        result.error = "WIDGET_PLUGINS_DIR is not set"
        return result
    root = Path(plugins_dir)
    try:
        if root.is_symlink():
            root = root.resolve(strict=True)
        if not root.is_dir():
            result.error = f"{plugins_dir} is not a directory"
            return result
    except OSError as exc:
        result.error = f"{plugins_dir} cannot be read: {exc}"
        return result

    for plugin_entry in sorted(os.scandir(root), key=lambda e: e.name):
        if plugin_entry.name.startswith("."):
            continue
        if not re.fullmatch(PLUGIN_ID_PATTERN, plugin_entry.name):
            result.rejected.append(f"{plugin_entry.name}: not a plugin id")
            continue
        if plugin_entry.is_symlink() or not plugin_entry.is_dir(follow_symlinks=False):
            result.rejected.append(f"{plugin_entry.name}: not a directory")
            continue
        for version_entry in sorted(os.scandir(plugin_entry.path), key=lambda e: e.name):
            name = f"{plugin_entry.name}/{version_entry.name}"
            if version_entry.name.startswith("."):
                continue
            if not re.fullmatch(VERSION_PATTERN, version_entry.name):
                result.rejected.append(f"{name}: not a version")
                continue
            if version_entry.is_symlink() or not version_entry.is_dir(follow_symlinks=False):
                result.rejected.append(f"{name}: not a directory")
                continue
            result.versions.append(
                inspect_version(
                    root,
                    plugin_entry.name,
                    version_entry.name,
                    pins=pins or {},
                    require_pins=require_pins,
                    max_files=max_files,
                    max_bytes=max_bytes,
                )
            )
    return result


def resolve_served_file(plugins_dir: str, version_path: str, file_path: str) -> Path | None:
    """The on-disk path of a served file, or None when it would leave the version
    directory or cross a symbolic link."""
    root = Path(plugins_dir).resolve()
    version_dir = (root / version_path).resolve()
    if root not in version_dir.parents:
        return None
    candidate = version_dir
    for part in file_path.split("/"):
        if part in {"", ".", ".."}:
            return None
        candidate /= part
        if candidate.is_symlink():
            return None
    if version_dir not in candidate.resolve().parents:
        return None
    return candidate if candidate.is_file() else None
