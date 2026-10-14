"""Plugin packages with a backend, for the plugin runner's tests. Only the discovery module is
imported, so the sandbox tests run in a bare Linux container with pydantic and httpx."""

import json
from pathlib import Path

from api.widget_plugins.discovery import package_checksum, sha256_file, version_digest


def backend_manifest(plugin_id: str, version: str) -> dict:
    return {
        "manifestVersion": 1,
        "id": plugin_id,
        "version": version,
        "name": "Runner test",
        "description": "A backend for the runner's tests",
        "publisher": {"name": "Tests"},
        "host": {"api": 1, "afm": "0.11"},
        "entry": {"module": "entry.js"},
        "server": {"backend": {"protocol": 1, "routes": [{"id": "probe", "args": {}}]}},
        "contributes": {
            "widgets": [
                {
                    "id": "probe",
                    "name": "Probe",
                    "standalone": True,
                    "permissions": ["core:backend:call"],
                    "server": {"routes": ["probe"]},
                }
            ]
        },
    }


def write_backend_package(
    root: Path, plugin_id: str, version: str, files: dict[str, bytes], manifest: dict | None = None
) -> tuple[Path, str]:
    """Writes ``<root>/<id>/<version>/`` and returns it with its version digest."""
    directory = root / plugin_id / version
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in {"entry.js": b"export default { render() {} };\n", **files}.items():
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    hashes = {p.relative_to(directory).as_posix(): sha256_file(p) for p in directory.rglob("*") if p.is_file()}
    data = dict(manifest or backend_manifest(plugin_id, version))
    data["checksum"] = package_checksum(hashes)
    (directory / "plugin.json").write_text(json.dumps(data), encoding="utf-8")
    hashes["plugin.json"] = sha256_file(directory / "plugin.json")
    return directory, version_digest(hashes)
