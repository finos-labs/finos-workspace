from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class Model(BaseModel):
    model_config = ConfigDict(
        extra="forbid", from_attributes=True, populate_by_name=True
    )


class TokenCreateRequest(Model):
    name: str = Field(min_length=1, max_length=100)


class TokenMetadata(Model):
    uuid: UUID
    name: str
    token_type: str
    token_prefix: str
    created_date: Any | None = None
    updated_date: Any | None = None
    last_used_at: Any | None = None


class TokenCreateResponse(TokenMetadata):
    token: str


class BrowserSessionStartRequest(Model):
    client_name: str = Field(default="workspace-ui", description="The name of the client that opens the session.")
    current_dashboard_id: str | None = Field(default=None, description="The dashboard that the tab shows.")
    current_tab_id: str | None = Field(default=None, description="The inner tab that the tab shows.")


class BrowserSessionContext(Model):
    current_dashboard_id: str | None = Field(default=None, description="The dashboard that the tab shows.")
    current_tab_id: str | None = Field(default=None, description="The inner tab that the tab shows.")


class BrowserSession(Model):
    session_id: str = Field(description="The id of the session, which the WebSocket address carries.")
    client_name: str = Field(description="The name of the client that opened the session.")
    current_dashboard_id: str | None = Field(default=None, description="The dashboard that the tab shows.")
    current_tab_id: str | None = Field(default=None, description="The inner tab that the tab shows.")


class BrowserSessionStartResponse(Model):
    session: BrowserSession = Field(description="The new session.")
    websocket_url: str = Field(description="The address of the WebSocket that the tab opens.")


class BridgeError(Model):
    code: Literal[
        "invalid_request",
        "unauthorized",
        "unavailable",
        "timeout",
        "command_failed",
        "unknown",
    ] = Field(description="What kind of failure it is.")
    message: str = Field(description="A sentence that says what went wrong.")
    details: dict[str, Any] | None = Field(default=None, description="Further information, where there is any.")
    retryable: bool = Field(default=False, description="Whether the client can try again.")


class WorkspaceCommandResult(Model):
    ok: bool = Field(description="Whether the command succeeded.")
    command: str = Field(description="The name of the command.")
    request_id: str | None = Field(default=None, description="The id of the request that this result answers.")
    message: str = Field(description="A sentence that describes the outcome.")
    data: Any | None = Field(default=None, description="The result, which depends on the command.")
    error: BridgeError | None = Field(default=None, description="The failure. It is present when ok is false.")
    warnings: list[str] = Field(default_factory=list, description="Warnings about the result.")


class BrowserCommandResultMessage(Model):
    type: Literal["command_result"]
    result: WorkspaceCommandResult = Field(description="The result of the command.")


class BrowserPing(Model):
    type: Literal["ping"]


class BrowserSessionContextChangedMessage(Model):
    type: Literal["session_context_changed"]
    session: BrowserSessionContext = Field(description="Where the user is now.")


BrowserMessage = Annotated[
    BrowserCommandResultMessage | BrowserPing | BrowserSessionContextChangedMessage,
    Field(discriminator="type"),
]


class SessionReadyEvent(Model):
    type: Literal["session_ready"]
    session: BrowserSession = Field(description="The session that is now live.")


class CommandRequestEvent(Model):
    type: Literal["command_request"]
    command: dict[str, Any] = Field(
        description="The command. Its command field names it and its request_id field identifies the call."
    )


class ErrorEvent(Model):
    type: Literal["error"]
    error: BridgeError = Field(description="What the API refuses.")


class PongEvent(Model):
    type: Literal["pong"]


browser_message_adapter: TypeAdapter[BrowserMessage] = TypeAdapter(BrowserMessage)
