export interface WidgetParam {
  name: string;
  type: string;
  description: string;
  default_value?: unknown;
  current_value?: unknown;
  options?: unknown[];
}

export interface Widget {
  uuid?: string;
  origin: string;
  widget_id: string;
  name: string;
  description: string;
  widget_type?: string;
  params: WidgetParam[];
  category?: string;
  sub_category?: string;
  source?: string | null;
  metadata?: Record<string, unknown>;
  mcp_tool?: WidgetMcpLink;
}

export interface WidgetMcpLink {
  server_id: string;
  tool_name: string;
  args?: Record<string, string | number | boolean>;
}

export interface ChatMessage {
  role: "human" | "ai";
  content: string | Record<string, unknown>;
  agent_id?: string;
}

export interface ToolMessage {
  role: "tool";
  function: string;
  input_arguments: Record<string, unknown>;
  data: Array<{
    items: Array<{
      content?: string;
      url?: string;
      data_format?: Record<string, unknown>;
      [key: string]: unknown;
    }>;
  }>;
  extra_state?: Record<string, unknown>;
}

export type Message = ChatMessage | ToolMessage;

export interface SkillCatalogEntry {
  slug: string;
  description: string;
  updatedAt: string;
}

export interface SkillPayload {
  slug: string;
  description: string;
  contentMarkdown?: string;
  source: "forced_slash" | "model_selected";
}

export interface AgentTool {
  name: string;
  tool_name?: string;
  server_id: string;
  url: string;
  description?: string;
  input_schema?: {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

export interface DashboardWidgetInfo {
  widget_uuid: string;
  name?: string;
}

export interface DashboardTab {
  tab_id: string;
  widgets?: DashboardWidgetInfo[];
}

export interface DashboardInfo {
  id: string;
  name?: string;
  current_tab_id: string;
  tabs?: DashboardTab[];
}

export interface WorkspaceState {
  current_page_context: string;
  current_dashboard_uuid?: string;
  current_dashboard_info?: DashboardInfo | null;
  action_history?: string[];
}

export type UploadedDocumentFormat = "pdf" | "docx" | "txt" | "md" | "html";

export interface UploadedDocument {
  id: string;
  name: string;
  format: UploadedDocumentFormat;
  content_b64?: string;
  url?: string;
}

export interface QueryRequest {
  messages: Message[];
  context?: unknown[];
  widgets?: {
    primary?: Widget[];
    secondary?: Widget[];
    extra?: Widget[];
  };
  urls?: string[];
  timezone?: string;
  workspace_state?: unknown;
  workspace_options?: Record<string, boolean | string>;
  skills_catalog?: SkillCatalogEntry[];
  selected_skills?: SkillPayload[];
  model?: string;
  tools?: AgentTool[];
  documents?: UploadedDocument[];
}

export interface HtmlArtifact {
  type: "html";
  uuid: string;
  name: string;
  description: string;
  content: string;
}

export interface AppsJsonLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  state?: {
    params?: Record<string, unknown>;
    chartView?: {
      enabled: boolean;
      chartType?: "line" | "bar" | "pie" | "scatter" | "donut";
    };
  };
}

export interface AppsJsonTab {
  id: string;
  name: string;
  layout: AppsJsonLayoutItem[];
}

export interface AppsJsonGroup {
  name: string;
  type: "param" | "endpointParam";
  paramName?: string;
  defaultValue: string;
  widgetIds: string[];
}

export interface AppsJsonDef {
  name: string;
  description: string;
  allowCustomization: boolean;
  tabs: Record<string, AppsJsonTab>;
  groups: AppsJsonGroup[];
  prompts?: string[];
}

export interface AppArtifactWidgetRef {
  i: string;
  origin: string;
  widget_id: string;
  uuid?: string;
  name: string;
}

export interface AppArtifact {
  type: "app";
  uuid: string;
  name: string;
  description: string;
  app: AppsJsonDef;
  widget_refs: AppArtifactWidgetRef[];
}

export type CopilotArtifact = HtmlArtifact | AppArtifact;

export interface WidgetCitationSourceInfo {
  type: "widget";
  uuid: string;
  origin: string;
  widget_id: string;
  name: string;
  description: string;
  metadata: {
    input_args: Record<string, unknown>;
    widget_uuid: string;
  };
  citable: true;
}

export interface WebCitationSourceInfo {
  type: "web";
  name: string;
  citable: true;
}

export interface FileCitationSourceInfo {
  type: "file";
  name: string;
  citable: true;
}

export type CitationSourceInfo =
  | WidgetCitationSourceInfo
  | WebCitationSourceInfo
  | FileCitationSourceInfo;

export interface Citation {
  id: string;
  source_info: CitationSourceInfo;
  details: Array<Record<string, unknown>>;
  signature: string;
  quote_bounding_boxes?: null;
}

export interface CitationCollection {
  citations: Citation[];
}

export type SSEEventType =
  | "copilotMessageChunk"
  | "copilotStatusUpdate"
  | "copilotFunctionCall"
  | "copilotMessageArtifact"
  | "copilotCitationCollection"
  | "copilotPromptSuggestions";

export interface SSEEvent {
  event: SSEEventType;
  data: Record<string, unknown>;
}

export interface ReasoningArtifact {
  message: string;
  artifacts: CopilotArtifact[];
}
