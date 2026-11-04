import os
from dataclasses import dataclass, field, fields
from typing import Any

ENV_PREFIX = "WORKSPACE_MCP_"

RESULT_OFFLOAD_THRESHOLD_DEFAULT = 40000
RESULT_OFFLOAD_THRESHOLD_DESCRIPTION = (
    "The size, in characters, from which a tool result is not returned inline: the tool returns a "
    "reference that the client reads as a resource, so that a large result does not fill the "
    "conversation. It applies to the Workspace MCP in the API and in the sidecar."
)


def result_offload_threshold() -> int:
    return int(
        os.getenv(
            f"{ENV_PREFIX}RESULT_OFFLOAD_THRESHOLD",
            str(RESULT_OFFLOAD_THRESHOLD_DEFAULT),
        )
    )


def parse_csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(entry.strip() for entry in value.split(",") if entry.strip())


def _setting(default: Any, name: str, description: str) -> Any:
    return field(default=default, metadata={"env": name, "description": description})


@dataclass(slots=True)
class Settings:
    host: str = _setting("127.0.0.1", "HOST", "The interface on which the sidecar listens.")
    port: int = _setting(8787, "PORT", "The port on which the sidecar listens.")
    mcp_path: str = _setting("/mcp", "MCP_PATH", "The path of the streamable HTTP endpoint of the MCP server.")
    health_path: str = _setting("/health", "HEALTH_PATH", "The path of the health check.")
    session_start_path: str = _setting(
        "/bridge/session/start",
        "SESSION_START_PATH",
        "The path at which a Workspace tab starts a bridge session.",
    )
    websocket_path: str = _setting(
        "/bridge/ws",
        "WEBSOCKET_PATH",
        "The path of the WebSocket that a Workspace tab keeps open to receive commands.",
    )
    command_timeout_seconds: float = _setting(
        15.0,
        "COMMAND_TIMEOUT_SECONDS",
        "How many seconds the sidecar waits for a Workspace tab to answer one command.",
    )
    cors_allow_origins: tuple[str, ...] = _setting(
        (),
        "CORS_ALLOW_ORIGINS",
        "The origins that may call the sidecar from a browser, comma-separated. When it is empty, the "
        "origins of the local loopback addresses are allowed.",
    )

    @classmethod
    def from_env(cls) -> "Settings":
        parsers: dict[Any, Any] = {str: str, int: int, float: float, tuple[str, ...]: parse_csv}
        values = {}
        for item in fields(cls):
            raw = os.getenv(f"{ENV_PREFIX}{item.metadata['env']}")
            if raw is not None:
                values[item.name] = parsers[item.type](raw)
        return cls(**values)

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"
