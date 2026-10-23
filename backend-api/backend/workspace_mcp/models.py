from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    field_validator,
)

type BridgeErrorCode = Literal[
    "invalid_request",
    "unauthorized",
    "unavailable",
    "timeout",
    "command_failed",
    "unknown",
]
type NavigationOperation = Literal["create", "add_tabs", "remove_tabs", "rename_tabs"]
type GenerativeWidgetType = Literal["note", "html"]
type DashboardOperation = Literal["create", "read", "update"]
type WorkspaceNavigationOperation = Literal["dashboard", "tab"]
type BackendsOperation = Literal["list", "add", "update", "refresh", "remove"]
type AppsOperation = Literal["list", "read", "instantiate"]
type EndpointHeaderLocation = Literal["headers", "query"]
type BridgePayload = dict[str, Any]
type BridgePayloadList = list[BridgePayload]


def new_request_id() -> str:
    return f"cmd_{uuid4().hex}"


def widget_groups() -> dict[str, list[dict[str, Any]]]:
    return {"primary": [], "secondary": [], "extra": []}


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class BridgeError(Model):
    code: BridgeErrorCode
    message: str
    details: dict[str, Any] | None = None
    retryable: bool = False


class BrowserSessionStartRequest(Model):
    client_name: str = "workspace-ui"
    current_dashboard_id: str | None = None
    current_tab_id: str | None = None


class BrowserSessionContext(Model):
    current_dashboard_id: str | None = None
    current_tab_id: str | None = None


class BrowserSession(Model):
    session_id: str
    client_name: str
    current_dashboard_id: str | None = None
    current_tab_id: str | None = None


class BrowserSessionStartResponse(Model):
    session: BrowserSession
    websocket_url: str


class AgentFeatureSelectOption(BaseModel):
    label: str
    value: str


class AgentFeatureOption(BaseModel):
    label: str
    type: Literal["toggle", "text", "select"] | None = None
    default: bool | str | None = None
    description: str | None = None
    placeholder: str | None = None
    options: list[AgentFeatureSelectOption] | None = None


class WorkspaceAgent(BaseModel):
    holder_url: str | None = None
    id: str
    name: str
    description: str | None = None
    features: dict[str, bool | AgentFeatureOption] = Field(default_factory=dict)


class WidgetInfo(BaseModel):
    widget_uuid: str
    name: str


class TabInfo(BaseModel):
    tab_id: str = "__no_tab__"
    widgets: list[WidgetInfo] | None = None


class DashboardInfo(BaseModel):
    id: str
    name: str
    current_tab_id: str
    tabs: list[TabInfo] | None = None


class WorkspaceState(BaseModel):
    action_history: list[str] | None = None
    agents: list[WorkspaceAgent] | None = None
    current_dashboard_uuid: UUID | None = None
    current_dashboard_info: DashboardInfo | None = None
    current_page_context: str | None = None


class AgentTool(BaseModel):
    server_id: str | None = None
    name: str
    url: str
    endpoint: str | None = None
    description: str | None = None
    input_schema: dict[str, Any] | None = None


class WorkspaceSnapshot(Model):
    generated_at: int
    workspace_state: WorkspaceState | None = None
    workspace_options: list[str] = Field(default_factory=list)
    dashboards: list[dict[str, Any]] = Field(default_factory=list)
    dashboard_composition: dict[str, Any] | None = None
    widgets: dict[str, list[dict[str, Any]]] = Field(default_factory=widget_groups)
    context: list[dict[str, Any]] = Field(default_factory=list)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    files: list[dict[str, Any]] = Field(default_factory=list)
    tools: list[AgentTool] = Field(default_factory=list)
    skills: list[dict[str, Any]] = Field(default_factory=list)


class WorkspaceWidgetConfig(Model):
    data_args: dict[str, Any] | None = None
    ui_args: dict[str, Any] | None = None


class WidgetDataRequest(Model):
    origin: str = Field(validation_alias=AliasChoices("origin", "backend_name"))
    widget_id: str
    data_args: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices(
            "data_args",
            "params",
            "input_args",
            "dataArgs",
            "inputArgs",
        ),
    )
    widget_uuid: str | None = None


class ParamOptionsRequest(Model):
    origin: str = Field(validation_alias=AliasChoices("origin", "backend_name"))
    widget_id: str
    param_name: str
    data_args: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices(
            "data_args",
            "params",
            "options_endpoint_input_args",
            "dataArgs",
            "optionsEndpointInputArgs",
        ),
    )


class GetWidgetDataCommand(Model):
    command: Literal["get_widget_data"]
    request_id: str | None = None
    data_sources: BridgePayloadList = Field(default_factory=list)


class ListAvailableWidgetsCommand(Model):
    command: Literal["list_available_widgets"]
    request_id: str | None = None
    origin: str | None = None
    backend_id: str | None = None


class GetWidgetSchemaCommand(Model):
    command: Literal["get_widget_schema"]
    request_id: str | None = None
    origin: str | None = None
    widget_id: str


class GetWidgetsSchemaCommand(Model):
    command: Literal["get_widgets_schema"]
    request_id: str | None = None


class GetParamOptionsCommand(Model):
    command: Literal["get_params_options"]
    request_id: str | None = None
    param_options_queries: BridgePayloadList = Field(default_factory=list)


class ReadWidgetCommand(Model):
    command: Literal["read_widget"]
    request_id: str | None = None
    dashboard_id: str | None = None
    widget_uuid: str | None = None
    widget_id: str | None = None


class CreateWidgetCommand(Model):
    command: Literal["create_widget"]
    request_id: str | None = None
    dashboard_id: str | None = None
    backend_name: str = Field(validation_alias=AliasChoices("backend_name", "origin"))
    widget_id: str
    config: WorkspaceWidgetConfig | None = None
    dry_run: bool | None = None


class UpdateWidgetCommand(Model):
    command: Literal["update_widget"]
    request_id: str | None = None
    dashboard_id: str | None = None
    widget_uuid: str | None = None
    widget_id: str | None = None
    config: WorkspaceWidgetConfig
    dry_run: bool | None = None


class DeleteWidgetCommand(Model):
    command: Literal["delete_widget"]
    request_id: str | None = None
    dashboard_id: str | None = None
    widget_uuid: str | None = None
    widget_id: str | None = None


class ManageDashboardCommand(Model):
    command: Literal["manage_dashboard"]
    request_id: str | None = None
    operation: DashboardOperation
    dashboard_id: str | None = None
    name: str | None = None
    activate: bool | None = None


class NavigateWorkspaceCommand(Model):
    command: Literal["navigate_workspace"]
    request_id: str | None = None
    operation: WorkspaceNavigationOperation
    dashboard_id: str | None = None
    tab_id: str | None = None


class UpdateDashboardLayoutCommand(Model):
    command: Literal["update_dashboard_layout"]
    request_id: str | None = None
    dashboard_id: str | None = None
    widget_uuid: str | None = None
    widget_id: str | None = None
    tab_id: str | None = None
    x: float
    y: float
    w: float
    h: float
    min_w: float | None = None
    min_h: float | None = None
    max_w: float | None = None
    max_h: float | None = None


class ManageNavigationBarCommand(Model):
    command: Literal["manage_navigation_bar"]
    request_id: str | None = None
    dashboard_id: str | None = None
    operation: NavigationOperation
    tabs: list[dict[str, Any]] = Field(default_factory=list)
    rename_map: dict[str, str] = Field(default_factory=dict)


class AddGenerativeWidgetCommand(Model):
    command: Literal["add_generative_widget"]
    request_id: str | None = None
    dashboard_id: str | None = None
    widget_type: GenerativeWidgetType
    data: str | None = None
    name: str | None = None
    description: str | None = None
    inner_tab: str | None = None


class AssignTasksToAgentsCommand(Model):
    command: Literal["assign_tasks_to_agents"]
    request_id: str | None = None
    task_requests: BridgePayloadList = Field(default_factory=list)


class GetSkillContentCommand(Model):
    command: Literal["get_skill_content"]
    request_id: str | None = None
    slug: str
    reason: str | None = None


class GetWorkspaceSnapshotCommand(Model):
    command: Literal["get_workspace_snapshot"]
    request_id: str | None = None


class BackendEndpointHeader(Model):
    key: str
    value: str
    location: EndpointHeaderLocation = "headers"


class NavigationTabInput(Model):
    name: str

    @field_validator("name")
    @classmethod
    def _name_must_be_non_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("name must not be blank")
        return value


class TaskRequest(Model):
    id: str
    description: str
    assigned_holder_url: str
    assigned_agent_id: str


class ManageBackendsCommand(Model):
    command: Literal["manage_backends"]
    request_id: str | None = None
    operation: BackendsOperation
    backend_id: str | None = None
    name: str | None = None
    url: str | None = None
    endpoint_headers: list[BackendEndpointHeader] | None = None
    validate_widgets: bool | None = None


class ManageAppsCommand(Model):
    command: Literal["manage_apps"]
    request_id: str | None = None
    operation: AppsOperation
    backend_id: str | None = None
    app_name: str | None = None
    template_id: str | None = None
    dashboard_name: str | None = None
    activate: bool | None = None


type WorkspaceCommand = Annotated[
    GetWidgetDataCommand
    | ListAvailableWidgetsCommand
    | GetWidgetSchemaCommand
    | GetWidgetsSchemaCommand
    | GetParamOptionsCommand
    | ReadWidgetCommand
    | CreateWidgetCommand
    | UpdateWidgetCommand
    | DeleteWidgetCommand
    | ManageDashboardCommand
    | UpdateDashboardLayoutCommand
    | NavigateWorkspaceCommand
    | ManageNavigationBarCommand
    | AddGenerativeWidgetCommand
    | AssignTasksToAgentsCommand
    | GetSkillContentCommand
    | GetWorkspaceSnapshotCommand
    | ManageBackendsCommand
    | ManageAppsCommand,
    Field(discriminator="command"),
]


class WorkspaceCommandResult(Model):
    ok: bool
    command: str
    request_id: str | None = None
    message: str
    data: Any | None = None
    error: BridgeError | None = None
    warnings: list[str] = Field(default_factory=list)


class BrowserCommandResultMessage(Model):
    type: Literal["command_result"]
    result: WorkspaceCommandResult


class BrowserPing(Model):
    type: Literal["ping"]


class BrowserSessionContextChangedMessage(Model):
    type: Literal["session_context_changed"]
    session: BrowserSessionContext


type BrowserMessage = Annotated[
    BrowserCommandResultMessage | BrowserPing | BrowserSessionContextChangedMessage,
    Field(discriminator="type"),
]


class SessionReadyEvent(Model):
    type: Literal["session_ready"]
    session: BrowserSession


class CommandRequestEvent(Model):
    type: Literal["command_request"]
    command: WorkspaceCommand


class ErrorEvent(Model):
    type: Literal["error"]
    error: BridgeError


class PongEvent(Model):
    type: Literal["pong"]


type ServerEvent = SessionReadyEvent | CommandRequestEvent | ErrorEvent | PongEvent

workspace_command_adapter: TypeAdapter[WorkspaceCommand] = TypeAdapter(WorkspaceCommand)
browser_message_adapter: TypeAdapter[BrowserMessage] = TypeAdapter(BrowserMessage)
