import type {
  AddGenerativeWidgetInputArgumentsT,
  AssignTasksToAgentInputArgumentsT,
  GetParamOptionsInputArgumentsT,
  GetWidgetDataInputArgumentsT,
  ManageNavigationBarInputArgumentsT,
} from "~/lib/utils/ai";

export const BRIDGE_ERROR_CODES = [
  "invalid_request",
  "unauthorized",
  "unavailable",
  "timeout",
  "command_failed",
  "unknown",
] as const;
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

export const BRIDGE_LIMITS = {
  reconnectBaseDelayMs: 1000,
  maxReconnectAttempts: 3,
  sessionStartTimeoutMs: 10_000,
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 32_000,
} as const;

export type WorkspaceWidgetConfig = {
  data_args?: Record<string, unknown> | null;
  ui_args?: Record<string, unknown> | null;
};

type CommandBase<T extends string = string> = {
  command: T;
  request_id?: string | null;
};

type GetWorkspaceSnapshotCommand = CommandBase<"get_workspace_snapshot">;

type GetWidgetDataCommand = CommandBase<"get_widget_data"> & {
  data_sources?: GetWidgetDataInputArgumentsT["data_sources"] | null;
};

type ListAvailableWidgetsCommand = CommandBase<"list_available_widgets"> & {
  origin?: string | null;
  backend_id?: string | null;
};

type GetWidgetSchemaCommand = CommandBase<"get_widget_schema"> & {
  origin?: string | null;
  widget_id?: string | null;
};

type GetWidgetsSchemaCommand = CommandBase<"get_widgets_schema">;

type GetParamsOptionsCommand = CommandBase<"get_params_options"> & {
  param_options_queries?:
    | GetParamOptionsInputArgumentsT["param_options_queries"]
    | null;
};

type ReadWidgetCommand = CommandBase<"read_widget"> & {
  dashboard_id?: string | null;
  widget_uuid?: string | null;
  widget_id?: string | null;
};

type CreateWidgetCommand = CommandBase<"create_widget"> & {
  dashboard_id?: string | null;
  backend_name?: string | null;
  widget_id?: string | null;
  config?: WorkspaceWidgetConfig | null;
  dry_run?: boolean | null;
};

type UpdateWidgetCommand = CommandBase<"update_widget"> & {
  dashboard_id?: string | null;
  widget_uuid?: string | null;
  widget_id?: string | null;
  config?: WorkspaceWidgetConfig | null;
  dry_run?: boolean | null;
};

type DeleteWidgetCommand = CommandBase<"delete_widget"> & {
  dashboard_id?: string | null;
  widget_uuid?: string | null;
  widget_id?: string | null;
};

type ManageDashboardCommand = CommandBase<"manage_dashboard"> & {
  operation?: "create" | "read" | "update" | null;
  dashboard_id?: string | null;
  name?: string | null;
  activate?: boolean | null;
};

type UpdateDashboardLayoutCommand = CommandBase<"update_dashboard_layout"> & {
  dashboard_id?: string | null;
  widget_uuid?: string | null;
  widget_id?: string | null;
  tab_id?: string | null;
  x?: number | null;
  y?: number | null;
  w?: number | null;
  h?: number | null;
  min_w?: number | null;
  min_h?: number | null;
  max_w?: number | null;
  max_h?: number | null;
};

type ManageNavigationBarCommand = CommandBase<"manage_navigation_bar"> &
  ManageNavigationBarInputArgumentsT & {
    dashboard_id?: string | null;
  };

type AddGenerativeWidgetCommand = CommandBase<"add_generative_widget"> &
  AddGenerativeWidgetInputArgumentsT & {
    dashboard_id?: string | null;
  };

type AssignTasksToAgentsCommand = CommandBase<"assign_tasks_to_agents"> & {
  task_requests?: AssignTasksToAgentInputArgumentsT["task_requests"] | null;
};

type ExecuteAgentToolCommand = CommandBase<"execute_agent_tool"> & {
  server_id?: string | null;
  tool_name?: string | null;
  parameters?: Record<string, unknown> | null;
};

type GetSkillContentCommand = CommandBase<"get_skill_content"> & {
  slug?: string | null;
  reason?: string | null;
};

type NavigateWorkspaceCommand = CommandBase<"navigate_workspace"> & {
  operation?: "dashboard" | "tab" | null;
  dashboard_id?: string | null;
  tab_id?: string | null;
};

type BackendEndpointHeader = {
  key: string;
  value: string;
  location?: "headers" | "query" | null;
};

type ManageBackendsCommand = CommandBase<"manage_backends"> & {
  operation?: "list" | "add" | "update" | "refresh" | "remove" | null;
  backend_id?: string | null;
  name?: string | null;
  url?: string | null;
  endpoint_headers?: BackendEndpointHeader[] | null;
  validate_widgets?: boolean | null;
};

type ManageAppsCommand = CommandBase<"manage_apps"> & {
  operation?: "list" | "read" | "instantiate" | null;
  backend_id?: string | null;
  app_name?: string | null;
  template_id?: string | null;
  dashboard_name?: string | null;
  activate?: boolean | null;
};

export type WorkspaceBridgeCommand =
  | GetWorkspaceSnapshotCommand
  | GetWidgetDataCommand
  | ListAvailableWidgetsCommand
  | GetWidgetSchemaCommand
  | GetWidgetsSchemaCommand
  | GetParamsOptionsCommand
  | ManageDashboardCommand
  | UpdateDashboardLayoutCommand
  | NavigateWorkspaceCommand
  | ReadWidgetCommand
  | CreateWidgetCommand
  | UpdateWidgetCommand
  | DeleteWidgetCommand
  | ManageNavigationBarCommand
  | AddGenerativeWidgetCommand
  | AssignTasksToAgentsCommand
  | ExecuteAgentToolCommand
  | GetSkillContentCommand
  | ManageBackendsCommand
  | ManageAppsCommand;

const COMMAND_NAMES: Record<WorkspaceBridgeCommand["command"], true> = {
  get_workspace_snapshot: true,
  get_widget_data: true,
  list_available_widgets: true,
  get_widget_schema: true,
  get_widgets_schema: true,
  get_params_options: true,
  manage_dashboard: true,
  update_dashboard_layout: true,
  navigate_workspace: true,
  read_widget: true,
  create_widget: true,
  update_widget: true,
  delete_widget: true,
  manage_navigation_bar: true,
  add_generative_widget: true,
  assign_tasks_to_agents: true,
  execute_agent_tool: true,
  get_skill_content: true,
  manage_backends: true,
  manage_apps: true,
};
export const BRIDGE_COMMAND_NAMES = Object.keys(
  COMMAND_NAMES,
) as WorkspaceBridgeCommand["command"][];

export type WorkspaceBridgeCommandT<T extends WorkspaceBridgeCommand["command"]> =
  Extract<WorkspaceBridgeCommand, { command: T }>;

export interface WorkspaceBridgeCommandResult {
  ok: boolean;
  command: string;
  request_id?: string | null;
  message: string;
  data?: unknown;
  warnings?: string[];
  error?: {
    code: BridgeErrorCode;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}

interface BrowserSession {
  session_id: string;
  client_name: string;
  current_dashboard_id?: string | null;
  current_tab_id?: string | null;
}

export interface BrowserSessionContext {
  current_dashboard_id?: string | null;
  current_tab_id?: string | null;
}

export interface BrowserSessionStartResponse {
  session: BrowserSession;
  websocket_url: string;
}

interface SessionReadyEvent {
  type: "session_ready";
  session: BrowserSession;
}

interface CommandRequestEvent {
  type: "command_request";
  command: WorkspaceBridgeCommand;
}

interface ErrorEvent {
  type: "error";
  error?: {
    message?: string;
  };
}

interface PongEvent {
  type: "pong";
}

export type ServerEvent =
  | SessionReadyEvent
  | CommandRequestEvent
  | ErrorEvent
  | PongEvent;
export type ClientEvent =
  | { type: "ping" }
  | { type: "command_result"; result: WorkspaceBridgeCommandResult }
  | { type: "session_context_changed"; session: BrowserSessionContext };
