"""The runner's configuration (docs/widget-plugins/SERVER-SIDE.md 5.4): the backends it runs
and how, in a TOML file the deployer writes.

    plugins_dir = "/opt/widget-plugins"     # the API's WIDGET_PLUGINS_DIR

    [backends.sql-explorer]
    version = "1.1.3"
    digest = "sha256-..."                   # python -m scripts.plugin_check --digest
    command = ["/opt/plugin-envs/sql-explorer/bin/python", "-m", "uvicorn", "server:app", "--uds", "{socket}"]
    runtime = ["/opt/plugin-envs/sql-explorer"]
    network = ["tcp://db.internal:5432"]

Nothing in it is secret: secrets reach a backend per request (R6).
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path, PurePosixPath
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from api.widget_plugins.manifest import PLUGIN_ID_PATTERN, VERSION_PATTERN

closed = ConfigDict(extra="forbid")

# Never mounted into a sandbox: the deployment's data and configuration, the API's code and
# environment, the runner's own sockets, the kernel's interfaces and home directories
FORBIDDEN_SOURCES = (
    "/data",
    "/opt/code",
    "/opt/.venv",
    "/etc",
    "/run",
    "/var/run",
    "/proc",
    "/sys",
    "/dev",
    "/root",
    "/home",
    "/tmp",  # noqa: S108 - refused as a mount source, not used as a temporary directory
)
# The sandbox's own layout (sandbox.py), and /proc, which it leaves out: no mount may cover them
RESERVED_TARGETS = (
    *("/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32"),
    *("/etc", "/dev", "/proc", "/run", "/plugin"),
    "/tmp",  # noqa: S108 - the sandbox's own tmpfs, which a mount may not cover
)
FIRST_UID = 61000
MAX_PORT = 65535
DNS_NAME = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$")
ENDPOINT = re.compile(r"^(?P<scheme>https|tcp)://(?P<host>[^/:?#@\s]+)(:(?P<port>\d{1,5}))?$")
ENV_NAME = re.compile(r"^[A-Z_][A-Z0-9_]{0,63}$")
BROKER_HOST = "workspace-broker"

AbsolutePath = Annotated[str, StringConstraints(min_length=1, max_length=1024)]


def _absolute(path: str) -> str:
    pure = PurePosixPath(path)
    if not pure.is_absolute() or ".." in pure.parts or str(pure) != path.rstrip("/") or path == "/":
        raise ValueError(f"{path!r} is not a plain absolute path")
    return str(pure)


def _overlaps(path: str, other: str) -> bool:
    return path == other or path.startswith(f"{other}/") or other.startswith(f"{path}/")


def _source(path: str) -> str:
    for forbidden in FORBIDDEN_SOURCES:
        if _overlaps(path, forbidden):
            raise ValueError(f"{path!r} is or holds {forbidden}, which never goes into a sandbox")
    return path


def _target(path: str) -> str:
    for reserved in RESERVED_TARGETS:
        if _overlaps(path, reserved):
            raise ValueError(f"{path!r} is or holds the sandbox's own {reserved}")
    return path


class Endpoint(BaseModel):
    """One host and port the backend may reach, through the runner's relay."""

    model_config = closed

    host: str
    port: int

    @classmethod
    def parse(cls, text: str) -> Endpoint:
        match = ENDPOINT.fullmatch(text)
        if not match:
            raise ValueError(f"{text!r}: an endpoint is https://<host>[:<port>] or tcp://<host>:<port>")
        host = match["host"]
        if not DNS_NAME.fullmatch(host) or host.replace(".", "").isdigit() or host == BROKER_HOST:
            raise ValueError(f"{text!r}: the host is a DNS name (an IP address cannot be relayed)")
        if host == "localhost" or host.endswith(".localhost"):
            raise ValueError(f"{text!r}: the container's own services are never an endpoint")
        if match["scheme"] == "tcp" and not match["port"]:
            raise ValueError(f"{text!r}: a tcp:// endpoint names its port")
        port = int(match["port"] or 443)
        if not 0 < port <= MAX_PORT:
            raise ValueError(f"{text!r}: no such port")
        return cls(host=host, port=port)


class Bind(BaseModel):
    """A directory of the container the backend reads, at a path of its own."""

    model_config = closed

    source: AbsolutePath
    target: AbsolutePath

    @field_validator("source")
    @classmethod
    def allowed_source(cls, value: str) -> str:
        return _source(_absolute(value))

    @field_validator("target")
    @classmethod
    def allowed_target(cls, value: str) -> str:
        return _target(_absolute(value))


class Backend(BaseModel):
    model_config = closed

    version: Annotated[str, StringConstraints(pattern=VERSION_PATTERN)]
    digest: Annotated[str, StringConstraints(pattern=r"^sha256-[A-Za-z0-9_-]{43}$")]
    command: list[Annotated[str, StringConstraints(min_length=1, max_length=4096)]] = Field(
        min_length=1, max_length=64
    )
    uid: Annotated[int, Field(ge=1000, le=2**31 - 2)] | None = None
    runtime: list[AbsolutePath] = Field(default_factory=list, max_length=16)
    readonly: list[Bind] = Field(default_factory=list, max_length=16)
    network: list[str] = Field(default_factory=list, max_length=32)
    broker: bool = False
    environment: dict[str, Annotated[str, StringConstraints(max_length=4096)]] = Field(
        default_factory=dict, max_length=64
    )
    memory_mb: Annotated[int, Field(ge=64, le=65536)] = 1024
    processes: Annotated[int, Field(ge=16, le=4096)] = 128
    files: Annotated[int, Field(ge=64, le=65536)] = 1024
    scratch_mb: Annotated[int, Field(ge=1, le=4096)] = 64

    @field_validator("command")
    @classmethod
    def runs_a_program(cls, value: list[str]) -> list[str]:
        _absolute(value[0])
        return value

    @field_validator("runtime")
    @classmethod
    def runtime_paths(cls, value: list[str]) -> list[str]:
        # Mounted at the same path inside
        return [_target(_source(_absolute(path))) for path in value]

    @field_validator("network")
    @classmethod
    def endpoints(cls, value: list[str]) -> list[str]:
        for text in value:
            Endpoint.parse(text)
        return value

    @field_validator("environment")
    @classmethod
    def names(cls, value: dict[str, str]) -> dict[str, str]:
        for name in value:
            if not ENV_NAME.fullmatch(name) or name.startswith("WORKSPACE_BACKEND_"):
                raise ValueError(f"{name!r} is not a variable a deployer sets")
        return value

    @model_validator(mode="after")
    def distinct_targets(self):
        targets = [bind.target for bind in self.readonly] + list(self.runtime)
        if len(set(targets)) != len(targets):
            raise ValueError("two mounts share a path")
        return self

    def endpoints_parsed(self) -> list[Endpoint]:
        return [Endpoint.parse(text) for text in self.network]


class RunnerConfig(BaseModel):
    model_config = closed

    plugins_dir: AbsolutePath
    socket_dir: AbsolutePath = "/run/widget-plugins"
    api_url: Annotated[str, StringConstraints(pattern=r"^http://[a-z0-9.-]+:\d{1,5}$")] = "http://127.0.0.1:8000"
    api_group: Annotated[str, StringConstraints(pattern=r"^[a-z_][a-z0-9_-]{0,31}$")] = "appuser"
    # A cgroup v2 directory the deployment delegated to the runner; each backend gets one
    # beneath it. Without it the limits are rlimits only.
    cgroup: AbsolutePath | None = None
    backends: dict[
        Annotated[str, StringConstraints(pattern=PLUGIN_ID_PATTERN)],
        Backend,
    ] = Field(min_length=1, max_length=64)

    @field_validator("plugins_dir", "socket_dir", "cgroup")
    @classmethod
    def plain(cls, value: str | None) -> str | None:
        return None if value is None else _absolute(value)

    @model_validator(mode="after")
    def mounts_stay_out(self):
        # A backend gets its own package, never the plugins directory or the runner's sockets
        own = [self.plugins_dir, self.socket_dir] + ([self.cgroup] if self.cgroup else [])
        for name, backend in self.backends.items():
            for path in [b.source for b in backend.readonly] + backend.runtime:
                for other in own:
                    if _overlaps(path, other):
                        raise ValueError(f"{name}: {path!r} is or holds {other}")
        return self

    @model_validator(mode="after")
    def uids(self):
        taken = {b.uid for b in self.backends.values() if b.uid is not None}
        if len(taken) != len([b for b in self.backends.values() if b.uid is not None]):
            raise ValueError("two backends share a uid")
        candidate = FIRST_UID
        for name in sorted(self.backends):
            backend = self.backends[name]
            if backend.uid is None:
                while candidate in taken:
                    candidate += 1
                backend.uid = candidate
                taken.add(candidate)
        return self


def load(path: Path) -> RunnerConfig:
    with path.open("rb") as f:
        return RunnerConfig.model_validate(tomllib.load(f))
