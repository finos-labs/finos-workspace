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
  /** What the widget is; `iframe` for a widget that embeds a page of its own backend. */
  widget_type?: string;
  params: WidgetParam[];
  category?: string;
  sub_category?: string;
  source?: string | null;
  metadata?: Record<string, unknown>;
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
  /** The skill's instructions; absent for one of Ines's own skills, whose instructions she has. */
  contentMarkdown?: string;
  source: "forced_slash" | "model_selected";
}

export interface AgentTool {
  /** The FINOS Workspace's name for the tool: `<server>_<tool>`. */
  name: string;
  /** The tool's own name on its MCP server. */
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
  /** Stable per-conversation identifier — used for caching + citation. */
  id: string;
  /** Display name (filename) shown to model + workspace. */
  name: string;
  format: UploadedDocumentFormat;
  /** Base64-encoded bytes. Mutually exclusive with `url`. */
  content_b64?: string;
  /**
   * URL the agent fetches once at request start. Mutually exclusive with
   * `content_b64`. Useful for Hub-hosted files where the workspace already
   * has them on disk.
   */
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
  /**
   * Documents the user attached to this conversation (PDF/DOCX/TXT/MD).
   * FINOS Workspace ships them on every POST in this chat; the agent decodes,
   * holds them in-memory, and ships them to the ines-tools MCP server's
   * `query_documents` tool via the `x-ines-documents` decoration.
   * Only the delta (docs not yet shipped this chat) is sent on each call,
   * tracked through `extra_state.documents_shipped` across re-POSTs.
   */
  documents?: UploadedDocument[];
}

export interface HtmlArtifact {
  type: "html";
  uuid: string;
  name: string;
  description: string;
  /** Inline HTML — workspace renders in a sandboxed iframe (Artifact.tsx:119). */
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
  type: "param" | "endpointParam" | "ticker";
  // Omitted for `ticker` groups — they bind to the workspace's universal ticker
  // registry, not a named widget param (apps.json spec).
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

/** The artifact types the FINOS Workspace renders and Ines emits; tables are `html`. */
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
