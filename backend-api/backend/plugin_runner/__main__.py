"""Runs the backends of a runner configuration (see ``plugin_runner.config``) until stopped."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import grp
import json
import logging
import os
import shutil
import signal
import sys
from pathlib import Path

from pydantic import ValidationError

from api.widget_plugins.discovery import inspect_version
from plugin_runner import relays
from plugin_runner.config import BROKER_HOST, Backend, RunnerConfig, load

log = logging.getLogger("plugin_runner")

CODE_DIR = Path(__file__).resolve().parents[1]
# Discovery's caps (WIDGET_PLUGINS_MAX_FILES, WIDGET_PLUGINS_MAX_UNPACKED_BYTES)
MAX_FILES = 200
MAX_BYTES = 64 * 1024 * 1024
FIRST_BACKOFF, MAX_BACKOFF, HEALTHY_AFTER = 1, 300, 60
STOP_GRACE = 15


def verify(config: RunnerConfig, name: str, backend: Backend) -> str | None:
    """Why the version on disk must not run, or None: its files are the pinned ones and it
    declares a backend (R7)."""
    if not (Path(config.plugins_dir) / name / backend.version).is_dir():
        return f"{name}/{backend.version} is not in the plugins directory"
    found = inspect_version(
        Path(config.plugins_dir),
        name,
        backend.version,
        pins={f"{name}@{backend.version}": backend.digest},
        require_pins=True,
        max_files=MAX_FILES,
        max_bytes=MAX_BYTES,
    )
    if found.blocked:
        return "; ".join(found.errors)
    if not ((found.manifest or {}).get("server") or {}).get("backend"):
        return "its manifest declares no backend"
    return None


def _directory(path: Path, uid: int, gid: int, mode: int) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    os.chown(path, uid, gid)
    os.chmod(path, mode)
    return path


def cgroup_for(config: RunnerConfig, name: str, backend: Backend) -> str | None:
    """The backend's cgroup with its limits, when the deployment delegated a cgroup."""
    if not config.cgroup:
        return None
    parent = Path(config.cgroup)
    (parent / "cgroup.subtree_control").write_text("+memory +pids")
    own = parent / name
    own.mkdir(exist_ok=True)
    (own / "memory.max").write_text(str(backend.memory_mb * 1024 * 1024))
    (own / "memory.swap.max").write_text("0")
    (own / "pids.max").write_text(str(backend.processes))
    return str(own)


def spec_for(config: RunnerConfig, name: str, backend: Backend, base: Path) -> dict:
    """What the sandbox helper is given: its paths, its endpoints and its limits."""
    hosts: dict[str, str] = {}
    endpoints = []
    for index, endpoint in enumerate(backend.endpoints_parsed()):
        hosts.setdefault(endpoint.host, f"127.0.0.{len(hosts) + 2}")
        endpoints.append(
            {"host": endpoint.host, "port": endpoint.port, "address": hosts[endpoint.host], "socket": f"{index}.sock"}
        )
    if backend.broker:
        endpoints.append(
            {"host": BROKER_HOST, "port": 80, "address": f"127.0.0.{len(hosts) + 2}", "socket": "broker.sock"}
        )
    return {
        "uid": backend.uid,
        "gid": backend.uid,
        "package": str(Path(config.plugins_dir) / name / backend.version),
        "command": backend.command,
        "environment": backend.environment,
        "runtime": backend.runtime,
        "readonly": [bind.model_dump() for bind in backend.readonly],
        "listen_dir": str(base / "listen"),
        "egress_dir": str(base / "egress"),
        "endpoints": endpoints,
        "limits": {
            "memory_mb": backend.memory_mb,
            "processes": backend.processes,
            "files": backend.files,
            "scratch_mb": backend.scratch_mb,
        },
        "cgroup": None,
    }


class Supervised:
    """One backend: its relays, and its sandbox started again when it ends."""

    def __init__(self, config: RunnerConfig, name: str, backend: Backend, api_gid: int):
        self.config, self.name, self.backend, self.api_gid = config, name, backend, api_gid
        self.base = Path(config.socket_dir) / name
        self.spec = spec_for(config, name, backend, self.base)
        self.servers: list[asyncio.base_events.Server] = []
        self.process: asyncio.subprocess.Process | None = None
        self.stopping = False

    async def start_relays(self) -> None:
        uid = gid = self.backend.uid or 0
        if not uid:
            raise ValueError(f"{self.name}: no uid")
        _directory(self.base, 0, 0, 0o755)
        listen = _directory(self.base / "listen", uid, gid, 0o700)
        for stale in listen.iterdir():
            stale.unlink()
        egress = _directory(self.base / "egress", 0, gid, 0o750)
        api_socket = str(Path(self.config.socket_dir) / f"{self.name}.sock")
        self.servers.append(
            await relays.unix_server(
                api_socket, relays.way_in(self.name, str(listen / "backend.sock")), uid=0, gid=self.api_gid, mode=0o660
            )
        )
        api_host, api_port = self.config.api_url.removeprefix("http://").rsplit(":", 1)
        for endpoint in self.spec["endpoints"]:
            if endpoint["host"] == BROKER_HOST:
                handler = relays.broker(self.name, api_host, int(api_port))
            else:
                handler = relays.way_out(self.name, endpoint["host"], endpoint["port"])
            path = str(egress / endpoint["socket"])
            self.servers.append(await relays.unix_server(path, handler, uid=0, gid=gid, mode=0o660))

    async def _output(self, stream: asyncio.StreamReader) -> None:
        while line := await stream.readline():
            log.info("%s: %s", self.name, line.decode("utf-8", "replace").rstrip()[:2000])

    async def run(self) -> None:
        backoff = FIRST_BACKOFF
        loop = asyncio.get_running_loop()
        while not self.stopping:
            try:
                self.spec["cgroup"] = cgroup_for(self.config, self.name, self.backend)
            except OSError as error:
                log.error("%s: refused to start: limits: cgroup: %s", self.name, error)
                return
            started = loop.time()
            self.process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "plugin_runner.sandbox",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=CODE_DIR,
                env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"},
            )
            if not (self.process.stdin and self.process.stdout):
                raise RuntimeError("the sandbox helper has no pipes")
            self.process.stdin.write(json.dumps(self.spec).encode())
            self.process.stdin.close()
            await self._output(self.process.stdout)
            code = await self.process.wait()
            if self.stopping:
                return
            log.warning("%s: the backend ended (%s); starting it again in %s s", self.name, code, backoff)
            backoff = FIRST_BACKOFF if loop.time() - started > HEALTHY_AFTER else min(backoff * 2, MAX_BACKOFF)
            await asyncio.sleep(backoff)

    async def stop(self) -> None:
        self.stopping = True
        if self.process and self.process.returncode is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                await asyncio.wait_for(self.process.wait(), STOP_GRACE)
            except TimeoutError:
                self.process.kill()
        for server in self.servers:
            server.close()
        with contextlib.suppress(FileNotFoundError):
            os.unlink(Path(self.config.socket_dir) / f"{self.name}.sock")
        shutil.rmtree(self.base, ignore_errors=True)


async def run(config: RunnerConfig) -> int:
    api_gid = grp.getgrnam(config.api_group).gr_gid
    _directory(Path(config.socket_dir), 0, 0, 0o755)
    supervised = []
    for name, backend in sorted(config.backends.items()):
        reason = verify(config, name, backend)
        if reason:
            log.error("%s: refused to start: integrity: %s", name, reason)
            continue
        item = Supervised(config, name, backend, api_gid)
        await item.start_relays()
        supervised.append(item)
    if not supervised:
        log.error("no backend can run")
        return 1

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    tasks = [asyncio.create_task(item.run()) for item in supervised]
    await stop.wait()
    await asyncio.gather(*(item.stop() for item in supervised))
    for task in tasks:
        task.cancel()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m plugin_runner", description=__doc__)
    parser.add_argument("config", type=Path, help="the runner's TOML configuration")
    parser.add_argument(
        "--environment",
        action="store_true",
        help="print the API's settings for this configuration as KEY=VALUE lines, and exit",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="plugin-runner: %(message)s", stream=sys.stderr)
    try:
        config = load(args.config)
    except (OSError, ValueError, ValidationError) as error:
        log.error("the configuration cannot be used: %s", error)
        return 2
    if args.environment:
        # The API reaches each backend through the runner's socket
        sockets = {name: f"unix:{config.socket_dir}/{name}.sock" for name in sorted(config.backends)}
        sys.stdout.write(f"WIDGET_PLUGINS_DIR={config.plugins_dir}\n")
        sys.stdout.write(f"WIDGET_PLUGIN_BACKENDS={json.dumps(sockets, separators=(',', ':'))}\n")
        return 0
    return asyncio.run(run(config))


if __name__ == "__main__":
    sys.exit(main())
