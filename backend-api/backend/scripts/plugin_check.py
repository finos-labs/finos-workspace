import argparse
import sys
from pathlib import Path

from api.widget_plugins.discovery import (
    inspect_version,
    package_checksum,
    sha256_file,
    version_digest,
)


def _hashes(directory: Path) -> dict[str, str]:
    return {
        path.relative_to(directory).as_posix(): sha256_file(path)
        for path in sorted(directory.rglob("*"))
        if path.is_file() and not path.is_symlink()
    }


def _say(text: str = "", stream=sys.stdout) -> None:
    stream.write(f"{text}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check a widget plugin package the way the server will, offline.")
    parser.add_argument("directory", type=Path, help="the <plugin-id>/<version> directory")
    parser.add_argument("--digest", action="store_true", help="only print the checksum and the version digest")
    parser.add_argument("--max-files", type=int, default=200)
    parser.add_argument("--max-bytes", type=int, default=64 * 1024 * 1024)
    args = parser.parse_args(argv)

    directory: Path = args.directory.resolve()
    if not directory.is_dir():
        _say(f"{directory} is not a directory", sys.stderr)
        return 2

    if args.digest:
        hashes = _hashes(directory)
        _say(f"checksum {package_checksum(hashes)}")
        _say(f"digest   {version_digest(hashes)}")
        return 0

    found = inspect_version(
        directory.parent.parent,
        directory.parent.name,
        directory.name,
        pins={},
        require_pins=False,
        max_files=args.max_files,
        max_bytes=args.max_bytes,
    )
    _say(f"{found.plugin_id}@{found.version}")
    _say(f"  files     {len(found.files)}")
    _say(f"  checksum  {found.checksum}")
    _say(f"  digest    {found.digest}")
    for warning in found.warnings:
        _say(f"  warning   {warning}")
    for error in found.errors:
        _say(f"  error     {error}")
    if found.blocked:
        _say("blocked: the server would not offer this version for approval")
        return 1
    _say("ok: the server would offer this version for approval")
    return 0


if __name__ == "__main__":
    sys.exit(main())
