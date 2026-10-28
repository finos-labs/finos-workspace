import type { ModelMessage, UserContent, TextPart, ImagePart, FilePart } from "ai";
import type {
  Citation,
  CopilotArtifact,
  SSEEvent,
  ToolMessage,
  Widget,
} from "../protocol/types.ts";
import { extractWidgetItems, type WidgetItem } from "../widgets/parse.ts";
import { asWidgetDataMessage } from "./workspace-widget-data.ts";
import { readParseAs, routeForParseAs } from "../widgets/parse-as.ts";
import { analyzeTable, sanitizeName, type TableInfo } from "../sql/loader.ts";
import { processMcpResult, type McpCitation, type McpResultSummary } from "../mcp/results.ts";
import type { CitedWidget } from "../protocol/citations.ts";
import { readExtraState } from "../protocol/extra-state.ts";
import { reasoningStep } from "../protocol/events.ts";
import { htmlTableArtifact } from "../protocol/html-table.ts";
import { WORKSPACE_BRIDGE_COMMAND_NAMES } from "../protocol/bridge-commands.ts";
import { forgetRows, rememberRows } from "./row-cache.ts";
import { formatWidgetDataLoadedStatuses } from "./tool-status.ts";
import { mcpDisplayName } from "./mcp-display.ts";
import type { PendingDocument } from "./documents.ts";
import { extractFileTierDocs } from "./file-docs.ts";
import { getLogger } from "../lib/logger.ts";
import { clipForModel, MAX_INLINE_TEXT_CHARS } from "./clip.ts";

const logger = getLogger(["app", "round-trip"]);

function detailRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function workspaceCommandResult(data: ToolMessage["data"]): Record<string, unknown> {
  const first = Array.isArray(data) ? data[0] : data;
  const firstRecord = detailRecord(first);
  const nested = detailRecord(firstRecord.data);
  return Object.keys(nested).length > 0 ? nested : firstRecord;
}

function workspaceCommandData(data: ToolMessage["data"]): Record<string, unknown> {
  const result = workspaceCommandResult(data);
  const nested = detailRecord(result.data);
  return Object.keys(nested).length > 0 ? nested : result;
}

function workspaceCommandSucceeded(data: ToolMessage["data"]): boolean {
  const first = Array.isArray(data) ? data[0] : data;
  const firstRecord = detailRecord(first);
  if (firstRecord.ok === false || firstRecord.status === "error") return false;
  if (firstRecord.ok === true || firstRecord.status === "success") return true;
  const result = workspaceCommandResult(data);
  if (result.ok === false || result.status === "error") return false;
  if (result.ok === true || result.status === "success") return true;
  return false;
}

function isWorkspaceBridgeResultFunction(functionName: string): boolean {
  return WORKSPACE_BRIDGE_COMMAND_NAMES.has(functionName);
}

function workspaceListWidgetsDetails(data: ToolMessage["data"]): Array<Record<string, unknown>> | undefined {
  const payload = workspaceCommandData(data);
  const widgets = Array.isArray(payload.widgets) ? payload.widgets : [];
  if (widgets.length === 0) return undefined;

  return widgets.map((widget) => {
    const record = detailRecord(widget);
    return {
      backend_name:
        asString(record.backend_name) ??
        asString(record.backend) ??
        asString(record.origin) ??
        null,
      widget_name:
        asString(record.name) ??
        asString(record.widget_name) ??
        null,
      description: asString(record.description) ?? null,
    };
  });
}

function workspaceListWidgetsArtifact(data: ToolMessage["data"]): CopilotArtifact[] | undefined {
  const rows = workspaceListWidgetsDetails(data);
  if (!rows?.length) return undefined;

  return [htmlTableArtifact("Available Widgets", "Widgets available from the selected FINOS Workspace catalog.", rows)];
}

function workspaceWidgetSchema(data: ToolMessage["data"]): Record<string, unknown> | undefined {
  const payload = workspaceCommandData(data);
  const widget = detailRecord(payload.widget);
  return Object.keys(widget).length > 0 ? widget : undefined;
}

function displaySchemaValue(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function schemaOptionLabel(option: unknown): string | undefined {
  const record = detailRecord(option);
  const label = asString(record.label);
  const value = asString(record.value);
  if (label && value && label !== value) return `${label} (${value})`;
  if (label) return label;
  if (value) return value;
  if (typeof option === "string") return option;
  return undefined;
}

function schemaOptionsSummary(options: unknown): string | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  const labels = options
    .map(schemaOptionLabel)
    .filter((label): label is string => !!label);
  if (labels.length === 0) return null;
  const shown = labels.slice(0, 20);
  return labels.length > shown.length
    ? `${shown.join(", ")} (+${labels.length - shown.length} more)`
    : shown.join(", ");
}

function workspaceWidgetSchemaRows(data: ToolMessage["data"]): Record<string, unknown>[] | undefined {
  const widget = workspaceWidgetSchema(data);
  const params = Array.isArray(widget?.params) ? widget.params : [];
  if (params.length === 0) return undefined;

  return params.map((param) => {
    const record = detailRecord(param);
    return {
      input:
        asString(record.paramName) ??
        asString(record.name) ??
        null,
      label: asString(record.label) ?? null,
      type: asString(record.type) ?? null,
      default_value: displaySchemaValue(record.value),
      multiple: typeof record.multiple === "boolean" ? record.multiple : null,
      visible: typeof record.show === "boolean" ? record.show : null,
      options: schemaOptionsSummary(record.options),
      description: asString(record.description) ?? null,
    };
  });
}

function workspaceWidgetSchemaArtifact(data: ToolMessage["data"]): CopilotArtifact[] | undefined {
  const widget = workspaceWidgetSchema(data);
  const rows = workspaceWidgetSchemaRows(data);
  if (!widget || !rows?.length) return undefined;
  const widgetName = asString(widget.name) ?? "Widget";

  return [htmlTableArtifact(`${widgetName} Schema`, `Input schema for ${widgetName}`, rows)];
}

function dashboardId(record: Record<string, unknown>): string | undefined {
  return asString(record.id) ?? asString(record.uuid) ?? asString(record.dashboard_id);
}

function tabName(tab: Record<string, unknown>): string | null {
  return asString(tab.tab_name) ?? asString(tab.name) ?? null;
}

function widgetName(widget: unknown): string {
  const record = detailRecord(widget);
  const nestedWidget = detailRecord(record.widget);
  return (
    asString(record.name) ??
    asString(record.widget_name) ??
    asString(record.title) ??
    asString(nestedWidget.name) ??
    asString(nestedWidget.widget_name) ??
    asString(nestedWidget.title) ??
    "Unnamed widget"
  );
}

interface SnapshotTab {
  name: string | null;
  id?: string;
  widgets: string[];
}

function tabsFromRecords(tabs: unknown[]): SnapshotTab[] {
  return tabs.map((tab) => {
    const record = detailRecord(tab);
    const id = asString(record.tab_id) ?? asString(record.id);
    const name = tabName(record);
    const widgets = Array.isArray(record.widgets)
      ? record.widgets
      : Array.isArray(record.layout)
        ? record.layout
        : [];
    return {
      name,
      ...(id ? { id } : {}),
      widgets: widgets.map(widgetName),
    };
  });
}

function snapshotTabs(payload: Record<string, unknown>): SnapshotTab[] {
  const composition = detailRecord(payload.dashboard_composition);
  const compositionTabs = Array.isArray(composition.tabs) ? composition.tabs : [];
  const workspaceState = detailRecord(payload.workspace_state);
  const dashboardInfo = detailRecord(workspaceState.current_dashboard_info);
  const stateTabs = Array.isArray(dashboardInfo.tabs) ? dashboardInfo.tabs : [];
  const tabs = compositionTabs.length > 0 ? compositionTabs : stateTabs;
  return tabsFromRecords(tabs);
}

function tabIsCurrent(tab: SnapshotTab, currentTabId: string | undefined): boolean {
  return !!currentTabId && (tab.id === currentTabId || tab.name === currentTabId);
}

function tabDisplayName(tab: SnapshotTab, currentTabId: string | undefined): string {
  const name = tab.name ?? "Unnamed tab";
  return tabIsCurrent(tab, currentTabId) ? `${name} (current)` : name;
}

function cappedStrings(items: string[], limit = 50): string[] {
  if (items.length <= limit) return items;
  return [...items.slice(0, limit), `... ${items.length - limit} more`];
}

function contextItemName(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  const record = detailRecord(value);
  return (
    asString(record.name) ??
    asString(record.title) ??
    asString(record.slug) ??
    asString(record.filename) ??
    asString(record.file_name) ??
    fallback
  );
}

function contextList(value: unknown, fallback: string): string[] {
  return cappedStrings(
    (Array.isArray(value) ? value : [])
      .map((item) => contextItemName(item, fallback)),
  );
}

function dashboardTabsObject(
  tabs: SnapshotTab[],
  currentTabId: string | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const tab of tabs) {
    out[tabDisplayName(tab, currentTabId)] = cappedStrings(tab.widgets);
  }
  return out;
}

function workspaceSnapshotDetails(data: ToolMessage["data"]): Record<string, unknown> | undefined {
  const payload = workspaceCommandData(data);
  if (Object.keys(payload).length === 0) return undefined;
  const workspaceState = detailRecord(payload.workspace_state);
  const dashboardInfo = detailRecord(workspaceState.current_dashboard_info);
  const sessionContext = detailRecord(payload.session_context);
  const currentDashboardId =
    asString(sessionContext.current_dashboard_uuid) ??
    asString(workspaceState.current_dashboard_uuid) ??
    dashboardId(dashboardInfo);
  const currentDashboardName = asString(dashboardInfo.name) ?? null;
  const currentTabId =
    asString(sessionContext.current_tab_id) ??
    asString(workspaceState.current_tab_id) ??
    asString(dashboardInfo.current_tab_id);
  const currentTabs = snapshotTabs(payload);
  const dashboardRecords = Array.isArray(payload.dashboards) ? payload.dashboards : [];
  const dashboards: Record<string, Record<string, string[]> | Record<string, never>> = {};
  let currentDashboardIncluded = false;
  for (const dashboard of dashboardRecords) {
    const record = detailRecord(dashboard);
    const id = dashboardId(record);
    const name = asString(record.name) ?? asString(record.title) ?? "Unnamed dashboard";
    const active = currentDashboardId && id
      ? id === currentDashboardId
      : !!currentDashboardName && name === currentDashboardName;
    if (active) currentDashboardIncluded = true;
    const recordTabs = Array.isArray(record.tabs) ? tabsFromRecords(record.tabs) : [];
    const tabs = active && currentTabs.length > 0 ? currentTabs : recordTabs;
    dashboards[name] = tabs.length > 0
      ? dashboardTabsObject(tabs, active ? currentTabId : undefined)
      : {};
  }
  if (!currentDashboardIncluded && currentDashboardName) {
    dashboards[currentDashboardName] = currentTabs.length > 0
      ? dashboardTabsObject(currentTabs, currentTabId)
      : {};
  }

  return {
    Dashboards: dashboards,
    Skills: contextList(payload.skills, "Unnamed skill"),
    Tools: contextList(payload.tools, "Unnamed tool"),
    Files: contextList(payload.files, "Unnamed file"),
    Artifacts: contextList(payload.artifacts, "Unnamed artifact"),
  };
}

function workspaceBridgeStatusDetails(
  toolMsg: ToolMessage,
): Record<string, unknown> | Array<Record<string, unknown>> | string | undefined {
  if (toolMsg.function === "get_workspace_snapshot") {
    return workspaceSnapshotDetails(toolMsg.data);
  }
  if (toolMsg.function === "list_available_widgets") {
    return undefined;
  }
  if (toolMsg.function === "get_widget_schema") {
    return undefined;
  }
  if (toolMsg.function === "add_widget_to_dashboard") {
    return undefined;
  }
  if (toolMsg.function === "manage_dashboard") {
    return workspaceCommandSucceeded(toolMsg.data)
      ? undefined
      : firstToolDataMessage(toolMsg.data) ?? "Dashboard command failed.";
  }
  if (toolMsg.function === "manage_navigation_bar") {
    return workspaceCommandSucceeded(toolMsg.data)
      ? undefined
      : firstToolDataMessage(toolMsg.data) ?? "Navigation update failed.";
  }
  if (toolMsg.function === "update_widget_in_dashboard") {
    return workspaceCommandSucceeded(toolMsg.data)
      ? undefined
      : firstToolDataMessage(toolMsg.data) ?? "Widget update failed.";
  }
  if (toolMsg.function === "add_generative_widget") {
    return workspaceCommandSucceeded(toolMsg.data)
      ? undefined
      : firstToolDataMessage(toolMsg.data) ?? "Generative widget creation failed.";
  }
  return {
    phase: "output",
    category: "tool_output",
    tool_name: toolMsg.function,
    input_params: toolMsg.input_arguments ?? {},
    output_preview: stringifyToolData(toolMsg.data, 4_000),
  };
}

function workspaceBridgeStatusArtifacts(toolMsg: ToolMessage): CopilotArtifact[] | undefined {
  if (toolMsg.function === "list_available_widgets") {
    return workspaceListWidgetsArtifact(toolMsg.data);
  }
  if (toolMsg.function === "get_widget_schema") {
    return workspaceWidgetSchemaArtifact(toolMsg.data);
  }
  return undefined;
}

function queryablePreviewRows(
  rows: Record<string, unknown>[],
  columns: TableInfo["columns"],
): Record<string, unknown>[] {
  return rows.slice(0, 5).map((row) =>
    Object.fromEntries(
      columns.map((col) => [col.name, row[col.originalName]]),
    ),
  );
}

/**
 * Read (without removing) the artifacts queued from `startIdx` on. The events
 * stay in the queue so the agent loop emits them as `copilotMessageArtifact`
 * in the message stream — the status update only references them by name.
 * (An earlier version spliced them out and embedded them in the status
 * `reasoningStep`, which buried charts in the collapsed timeline instead of
 * the chat message.)
 */
function peekQueuedArtifacts(queue: SSEEvent[], startIdx: number): CopilotArtifact[] {
  return queue.slice(startIdx)
    .filter((event) => event.event === "copilotMessageArtifact")
    .map((event) => event.data as unknown as CopilotArtifact);
}

function mcpResultDetails(summary: McpResultSummary, displayName: string): Record<string, unknown> | string {
  const output = summary.outputPreview.trim();
  if (output) return output;
  return {
    tool: displayName,
    textChars: summary.textChars,
    artifactCount: summary.artifactCount,
    citationCount: summary.citationCount,
    tableCount: summary.tableCount,
    errorCount: summary.errorCount,
    hasModelContext: summary.hasModelContext,
  };
}

function mcpResultMessage(summary: McpResultSummary, displayName: string): string {
  if (summary.errorCount > 0) return `${displayName} returned an error`;
  if (summary.tableCount > 0) return `Data from ${displayName} loaded`;
  if (summary.artifactCount > 0) return `Output from ${displayName}`;
  return `${displayName} completed`;
}

function mcpOutputArtifacts(summary: McpResultSummary, displayName: string): CopilotArtifact[] {
  if (summary.errorCount > 0 || !summary.outputRows || summary.outputRows.length === 0) {
    return [];
  }
  return [
    htmlTableArtifact(`${displayName} Output`, `Output returned by ${displayName}`, summary.outputRows),
  ];
}

function shouldEmitMcpResultStatus(
  summary: McpResultSummary,
  artifacts: CopilotArtifact[],
): boolean {
  return (
    summary.errorCount > 0 ||
    summary.tableCount > 0 ||
    artifacts.length > 0 ||
    summary.textChars > 0 ||
    summary.citationCount > 0 ||
    summary.hasModelContext
  );
}

function stringifyToolData(data: ToolMessage["data"], maxChars = 60_000): string {
  const payload = JSON.stringify(data ?? [], null, 2);
  if (payload.length <= maxChars) return payload;
  return `${payload.slice(0, maxChars)}\n... [truncated ${payload.length - maxChars} chars]`;
}

function firstToolDataMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstToolDataMessage(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["error", "message", "detail", "content"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  for (const key of ["data", "result", "response"]) {
    const found = firstToolDataMessage(record[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

function toolDataMessageTitle(value: unknown): string | undefined {
  const message = firstToolDataMessage(value)?.trim();
  if (!message) return undefined;
  return message.replace(/[.!?]+$/, "");
}

function workspaceBridgeResultMessage(functionName: string, data?: ToolMessage["data"]): string {
  switch (functionName) {
    case "get_workspace_snapshot":
      return "FINOS Workspace snapshot loaded";
    case "list_available_widgets":
      return "Available widgets listed";
    case "get_widget_schema":
      return "Widget schema loaded";
    case "get_params_options":
      return "Parameter options resolved";
    case "add_widget_to_dashboard":
      return "Widget creation result received";
    case "manage_dashboard":
      return data && workspaceCommandSucceeded(data)
        ? (toolDataMessageTitle(data) ?? "Dashboard command completed")
        : "Dashboard command failed";
    case "manage_navigation_bar":
      return data && workspaceCommandSucceeded(data)
        ? (toolDataMessageTitle(data) ?? "Navigation updated")
        : "Navigation update failed";
    case "update_widget_in_dashboard":
      return data && workspaceCommandSucceeded(data) ? "Widget update succeeded" : "Widget update failed";
    case "add_generative_widget":
      return data && workspaceCommandSucceeded(data)
        ? (toolDataMessageTitle(data) ?? "Generative widget created")
        : "Generative widget creation failed";
    case "read_widget":
      return "Widget read result received";
    default:
      return `FINOS Workspace command result received: ${functionName}`;
  }
}

export interface RoundTripContext {
  tables: TableInfo[];
  messages: ModelMessage[];
  allWidgets: Widget[];
  citedWidgets: Map<string, CitedWidget>;
  mcpCitations: McpCitation[];
  artifactQueue: SSEEvent[];
  intermediateCitations: Citation[];
  /**
   * Tables the SQL family queries. Populated by injectWidgetData and
   * processMcpResult; the SQL tools read it through their factory closure.
   */
  pendingTables: Map<string, Record<string, unknown>[]>;
  /**
   * Per-chat identifier from X-Trace-Id. Used as the key for the cross-
   * request row cache so a follow-up message can query the tables without
   * re-fetching widget data.
   */
  conversationId: string;
  /**
   * Uploaded documents pending ingestion at the MCP doc store. Seeded at
   * loop start from `request.documents` (legacy) and grown by
   * `extractFileTierDocs` whenever a `get_widget_data` round-trip returns
   * bytes for a `file-*` widget in a RAG-eligible format (pdf/docx/txt/md/
   * html). The loop's decoration step ships the delta on each
   * `query_documents` / `list_documents` call.
   */
  pendingDocuments?: Map<string, PendingDocument>;
  /**
   * True when the query_documents tool is among this request's tools. A document (PDF, DOCX) is not shown
   * to the model: it is told how to search it, or, when it cannot, that it cannot read it.
   */
  documentSearchAvailable?: boolean;
}

function resolveInputArgs(widget: Widget): Record<string, unknown> {
  return Object.fromEntries(
    widget.params.map((p) => [p.name, p.current_value ?? p.default_value]),
  );
}

function inputArgsForWidgetItem(item: WidgetItem): Record<string, unknown> {
  return {
    ...(item.widget ? resolveInputArgs(item.widget) : {}),
    ...detailRecord(item.inputArgs),
  };
}

function compactInputArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value != null && value !== ""),
  );
}

function widgetInputArgsLine(args: Record<string, unknown>): string {
  const compact = compactInputArgs(args);
  if (Object.keys(compact).length === 0) return "";
  return `Loaded with input parameters: ${JSON.stringify(compact)}\n`;
}

function stableInputArgsKey(args: Record<string, unknown>): string {
  const compact = compactInputArgs(args);
  return JSON.stringify(
    Object.keys(compact)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = compact[key];
        return acc;
      }, {}),
  );
}

function citedWidgetKey(widgetUuid: string, inputArgs: Record<string, unknown>): string {
  return `${widgetUuid}|${stableInputArgsKey(inputArgs)}`;
}

function findWidgetForDataSource(
  dataSource: Record<string, unknown>,
  allWidgets: Widget[],
): Widget | undefined {
  const widgetUuid = asString(dataSource.widget_uuid);
  const widgetId = asString(dataSource.id) ?? asString(dataSource.widget_id);
  return allWidgets.find((widget) =>
    (widgetUuid && widget.uuid === widgetUuid) ||
    (widgetId && widget.widget_id === widgetId),
  );
}

function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * A short, deterministic, readable token derived from a widget's input args,
 * used to disambiguate table names when the same widget is fetched with
 * different params (e.g. symbol AAPL vs MSFT). Prefers the scalar param values
 * ("aapl"); falls back to a hash only when no readable value is available.
 */
function tableNameToken(inputArgs: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(inputArgs)) {
    if (key === "query" || value == null || value === "") continue;
    parts.push(Array.isArray(value) ? value.join("_") : String(value));
  }
  return sanitizeName(parts.join("_")) || djb2(stableInputArgsKey(inputArgs));
}

/**
 * Map each item to the table name it should load under. Plain naming uses the
 * widget name; when several items in this batch share a base name but carry
 * different params (a multi-symbol comparison), each distinct dataset gets a
 * param-derived suffix so they stay independently queryable instead of
 * clobbering one table. Same (name, params) keeps one name — a refresh, not a
 * new dataset.
 */
function resolveTableNames(widgetItems: WidgetItem[]): Map<WidgetItem, string> {
  const datasetKeysByBase = new Map<string, Set<string>>();
  for (const item of widgetItems) {
    const base = sanitizeName(item.name);
    const keys = datasetKeysByBase.get(base) ?? new Set<string>();
    keys.add(stableInputArgsKey(inputArgsForWidgetItem(item)));
    datasetKeysByBase.set(base, keys);
  }
  const names = new Map<WidgetItem, string>();
  for (const item of widgetItems) {
    const base = sanitizeName(item.name);
    const collides = (datasetKeysByBase.get(base)?.size ?? 0) > 1;
    names.set(
      item,
      collides ? `${item.name} ${tableNameToken(inputArgsForWidgetItem(item))}` : item.name,
    );
  }
  return names;
}

function requestedDataSources(toolMsg: ToolMessage): Record<string, unknown>[] {
  const dataSources = toolMsg.input_arguments?.data_sources;
  return Array.isArray(dataSources)
    ? dataSources.filter((source): source is Record<string, unknown> =>
        source !== null && typeof source === "object" && !Array.isArray(source),
      )
    : [];
}

function candidateTableNamesForEmptyFetch(toolMsg: ToolMessage, allWidgets: Widget[]): string[] {
  const names = new Set<string>();
  for (const dataSource of requestedDataSources(toolMsg)) {
    const widget = findWidgetForDataSource(dataSource, allWidgets);
    if (!widget) continue;
    const baseName = sanitizeName(widget.name) || "data";
    names.add(baseName);

    const inputArgs = detailRecord(dataSource.input_args);
    if (Object.keys(compactInputArgs(inputArgs)).length > 0) {
      names.add(sanitizeName(`${widget.name} ${tableNameToken(inputArgs)}`) || "data");
    }
  }
  return [...names];
}

function stripLoadedTableInventoryLines(messages: ModelMessage[], tableNames: string[]): void {
  if (tableNames.length === 0) return;
  const stalePrefixes = tableNames.map((name) => `- "${name}" (`);
  for (const message of messages) {
    if (typeof message.content !== "string") continue;
    const lines = message.content.split("\n");
    const filtered = lines.filter((line) =>
      !stalePrefixes.some((prefix) => line.startsWith(prefix)),
    );
    if (filtered.length !== lines.length) {
      message.content = filtered.join("\n");
    }
  }
}

function invalidateEmptyWidgetFetchTables(toolMsg: ToolMessage, ctx: RoundTripContext): string[] {
  const tableNames = candidateTableNamesForEmptyFetch(toolMsg, ctx.allWidgets);
  const removed: string[] = [];
  for (const tableName of tableNames) {
    const wasPending = ctx.pendingTables.delete(tableName);
    const hadTableInfo = ctx.tables.some((table) => table.tableName === tableName);
    if (hadTableInfo) {
      ctx.tables.splice(0, ctx.tables.length, ...ctx.tables.filter((table) => table.tableName !== tableName));
    }
    forgetRows(ctx.conversationId, tableName);
    if (wasPending || hadTableInfo) removed.push(tableName);
  }
  stripLoadedTableInventoryLines(ctx.messages, removed);
  return removed;
}

export function injectWidgetData(
  widgetItems: WidgetItem[],
  ctx: RoundTripContext,
): void {
  if (widgetItems.length === 0) return;

  const tableNames = resolveTableNames(widgetItems);

  const parts: Array<TextPart | ImagePart | FilePart> = [
    {
      type: "text",
      text:
        "The following widget data has been fetched and loaded. Use it to answer the user's question.\n" +
        "Structured rows are queryable via the execute_sql tool (SQLite dialect).\n" +
        "Do NOT call get_widget_data again for these exact widgets. If the user's request needs fields that are not present in the loaded tables, fetch a different relevant widget. The listed table and column names are authoritative; never infer column names from table/display names.",
    },
  ];

  for (const item of widgetItems) {
    const inputArgs = inputArgsForWidgetItem(item);
    const inputArgsLine = widgetInputArgsLine(inputArgs);

    const citationKey = citedWidgetKey(item.uuid, inputArgs);
    if (item.widget && !ctx.citedWidgets.has(citationKey)) {
      ctx.citedWidgets.set(citationKey, {
        widget: item.widget,
        inputArgs,
        widgetUuid: item.uuid,
      });
    }

    const parseAs = readParseAs(item as unknown as { data_format?: Record<string, unknown> });
    const route = routeForParseAs(parseAs);
    let loadedAsTable = false;

    if (route.toSqlite && item.content.trim()) {
      try {
        const data = JSON.parse(item.content);
        if (
          Array.isArray(data) &&
          data.length > 0 &&
          typeof data[0] === "object" &&
          data[0] !== null &&
          !Array.isArray(data[0])
        ) {
          const rows = data as Record<string, unknown>[];
          const table = analyzeTable(tableNames.get(item) ?? item.name, rows);
          ctx.tables.push(table);
          ctx.pendingTables.set(table.tableName, rows);
          rememberRows(ctx.conversationId, table.tableName, rows, {
            widgetUuid: item.uuid,
            inputArgs,
          });
          loadedAsTable = true;

          const colLines = table.columns
            .map((col) => {
              const mapping = col.name !== col.originalName
                ? `; original label "${col.originalName}"`
                : "";
              return `  - "${col.name}" (${col.type}${mapping})`;
            })
            .join("\n");
          const preview = JSON.stringify(queryablePreviewRows(rows, table.columns), null, 2);
          parts.push({
            type: "text",
            text:
              `--- ${item.name} (uuid: ${item.uuid}) ---\n` +
              inputArgsLine +
              `[Structured data: ${table.rowCount} rows available as queryable table "${table.tableName}"]\n` +
              `Queryable columns — use these exact names in SQL and artifact xKey/yKey values:\n${colLines}\n` +
              `Preview with queryable column names (first 5 rows):\n${preview}\n\n` +
              `Original labels are shown only for reference; do not use them as SQL identifiers unless you alias queryable columns to those names. ` +
              `Never infer a column from the table/display name; if the metric is stored in a generic column such as "value", select that exact column and alias it in SQL. ` +
              `If table or column names are uncertain, call peek_table before execute_sql or create_artifact. ` +
              `Query via the execute_sql tool (SQLite dialect). Use double-quotes for identifiers.`,
          });

          logger.debug("Widget table prepared", {
            name: item.name,
            tableName: table.tableName,
            rows: table.rowCount,
          });
        }
      } catch {
        // Not valid JSON — fall through.
      }
    }

    if (!loadedAsTable && route.brief && item.content.trim()) {
      const summary = item.content.length > 500
        ? `${item.content.slice(0, 500)}... [truncated, ${item.content.length} chars total]`
        : item.content;
      parts.push({
        type: "text",
        text: `--- ${item.name} (uuid: ${item.uuid}) [HTML — brief] ---\n${inputArgsLine}${summary}`,
      });
    } else if (!loadedAsTable && route.asText && item.content.trim()) {
      // A file that is searchable is read further with the document search; anything else is only cut.
      const searchable = ctx.documentSearchAvailable && (ctx.pendingDocuments?.has(item.uuid) ?? false);
      const content = clipForModel(
        item.content,
        MAX_INLINE_TEXT_CHARS,
        searchable ? `read the rest of this file with query_documents, passing doc_ids ["${item.uuid}"]` : "",
      );
      parts.push({
        type: "text",
        text: `--- ${item.name} (uuid: ${item.uuid}) ---\n${inputArgsLine}${content}`,
      });
    }

    if (item.documentFormat) {
      parts.push({
        type: "text",
        text:
          `--- ${item.name} (uuid: ${item.uuid}) [FILE: ${item.documentFormat}] ---\n` +
          (ctx.documentSearchAvailable
            ? `This ${item.documentFormat.toUpperCase()} file is loaded for searching; its text is not shown to you here. ` +
              `Read it with query_documents, passing the question and doc_ids ["${item.uuid}"] to search only this file. ` +
              `Each result says which page it is on: give the page with what you took from it. ` +
              `Search again with other words when a result does not answer the question.`
            : `This ${item.documentFormat.toUpperCase()} file cannot be read: document search is not available here. ` +
              `Tell the user so; do not guess what is in it.`),
      });
    }

    if (item.parts?.length) {
      parts.push({ type: "text", text: `--- ${item.name} [media] ---` });
      parts.push(...item.parts);
    }
  }

  ctx.messages.push({ role: "user" as const, content: parts as UserContent });
  logger.debug("Widget data injected", {
    widgetCount: widgetItems.length,
    tableCount: ctx.tables.length,
  });
}

/** Gives the model a skill's instructions, whether the FINOS Workspace or Ines supplied them. */
export function injectSkill(slug: string, content: string, ctx: RoundTripContext): SSEEvent {
  ctx.messages.push({
    role: "user" as const,
    content: `Follow these skill instructions:\n\n${content}`,
  });
  return reasoningStep(`Skill "${slug}" loaded`, "INFO", {
    output_preview: content.slice(0, 4_000),
  });
}

export function extractSkillContent(toolMsg: ToolMessage): { slug: string; content: string } {
  const skillResult = toolMsg.data?.[0] as Record<string, unknown> | undefined;
  const slug = (toolMsg.input_arguments?.slug as string) ?? "unknown";

  if (skillResult?.status === "success") {
    const skill = (skillResult.data as Record<string, unknown>)?.skill as Record<string, unknown> | undefined;
    const content = (skill?.contentMarkdown as string) ?? "";
    logger.info("Skill loaded", { slug, chars: content.length });
    return { slug, content };
  }

  const err = (skillResult?.message as string) ?? "Skill not found";
  logger.warn("Skill load error", { slug, error: err });
  return { slug, content: `Skill "${slug}" could not be loaded: ${err}` };
}

/**
 * Side-channel data returned alongside the yielded events (read via
 * `const out = yield* injectFromReboot(...)`). `terminal` marks bridge
 * results that should not start another model turn.
 */
export interface InjectFromRebootResult {
  terminal?: boolean;
  terminalMessage?: string;
  suppressWidgetDataTool?: boolean;
  suppressWidgetDiscoveryTools?: boolean;
}

export async function* injectFromReboot(
  toolMsg: ToolMessage,
  ctx: RoundTripContext,
): AsyncGenerator<SSEEvent, InjectFromRebootResult> {
  // The result of the FINOS Workspace's MCP `get_widget_data` is taken in as the data of a widget round trip.
  toolMsg = asWidgetDataMessage(toolMsg, ctx.allWidgets) ?? toolMsg;

  // Restore intermediate citations from extra_state, if any
  const extra = readExtraState(toolMsg);
  if (extra.intermediate_citations?.length) {
    for (const c of extra.intermediate_citations) {
      ctx.intermediateCitations.push(c);
    }
    logger.debug("Restored intermediate citations", { count: extra.intermediate_citations.length });
  }
  if (extra.document_hits?.length) {
    ctx.mcpCitations.push(...extra.document_hits);
    logger.debug("Restored document hits", { count: extra.document_hits.length });
  }

  switch (toolMsg.function) {
    case "get_skill_content": {
      const { slug, content } = extractSkillContent(toolMsg);
      yield injectSkill(slug, content, ctx);
      return {};
    }

    case "get_params_options": {
      const payload = stringifyToolData(toolMsg.data);
      ctx.messages.push({
        role: "user" as const,
        content:
          "FINOS Workspace bridge result from get_params_options:\n\n" +
          `Input:\n${JSON.stringify(toolMsg.input_arguments ?? {}, null, 2)}\n\n` +
          `Output:\n${payload}`,
      });
      yield reasoningStep("Parameter options resolved", "INFO", {
        phase: "output",
        category: "tool_output",
        tool_name: "get_params_options",
        input_params: toolMsg.input_arguments ?? {},
        output_preview: payload.slice(0, 4_000),
      });
      return {};
    }

    case "execute_agent_tool": {
      const artifactStartIdx = ctx.artifactQueue.length;
      const summary = processMcpResult(toolMsg, {
        tables: ctx.tables,
        artifactQueue: ctx.artifactQueue,
        citations: ctx.mcpCitations,
        messages: ctx.messages,
        pendingTables: ctx.pendingTables,
        conversationId: ctx.conversationId,
      });
      const displayName = mcpDisplayName(summary.serverId, summary.toolName);
      const queuedArtifacts = peekQueuedArtifacts(ctx.artifactQueue, artifactStartIdx);
      const artifacts = [
        ...queuedArtifacts,
        ...(queuedArtifacts.length === 0 ? mcpOutputArtifacts(summary, displayName) : []),
      ];
      if (shouldEmitMcpResultStatus(summary, artifacts)) {
        const details = artifacts.length > 0 && summary.errorCount === 0
          ? undefined
          : mcpResultDetails(summary, displayName);
        yield reasoningStep(
          mcpResultMessage(summary, displayName),
          summary.errorCount > 0 ? "WARNING" : "INFO",
          details,
          artifacts,
        );
      }
      return {};
    }

    default: {
      if (isWorkspaceBridgeResultFunction(toolMsg.function)) {
        const payload = stringifyToolData(toolMsg.data);
        ctx.messages.push({
          role: "user" as const,
          content:
            `FINOS Workspace bridge result from ${toolMsg.function}:\n\n` +
            `Input:\n${JSON.stringify(toolMsg.input_arguments ?? {}, null, 2)}\n\n` +
            `Output:\n${payload}`,
        });
        yield reasoningStep(
          workspaceBridgeResultMessage(toolMsg.function, toolMsg.data),
          "INFO",
          workspaceBridgeStatusDetails(toolMsg),
          workspaceBridgeStatusArtifacts(toolMsg),
        );
        const terminalUpdateSucceeded =
          toolMsg.function === "update_widget_in_dashboard" &&
          workspaceCommandSucceeded(toolMsg.data);
        return {
          terminal: terminalUpdateSucceeded,
          terminalMessage: terminalUpdateSucceeded
            ? "Widget update succeeded."
            : undefined,
        };
      }

      // Default: assume widget data
      const widgetItems = await extractWidgetItems(toolMsg, ctx.allWidgets);
      let fileDocs: PendingDocument[] = [];
      if (ctx.pendingDocuments) {
        fileDocs = await extractFileTierDocs(toolMsg, ctx.allWidgets);
        for (const doc of fileDocs) {
          ctx.pendingDocuments.set(doc.id, doc);
        }
        if (fileDocs.length > 0) {
          logger.debug("File-tier docs added to pendingDocuments", {
            added: fileDocs.length,
            total: ctx.pendingDocuments.size,
          });
        }
      }
      if (widgetItems.length > 0) {
        const knownTables = new Set(ctx.tables.map((table) => table.tableName));
        injectWidgetData(widgetItems, ctx);
        const newTables = ctx.tables.filter((table) => !knownTables.has(table.tableName));
        const statuses = formatWidgetDataLoadedStatuses(widgetItems, newTables, {
          tableRows: ctx.pendingTables,
        });
        for (const status of statuses) {
          yield reasoningStep(status.message, status.eventType ?? "INFO", status.details, status.artifacts);
        }
      } else if (toolMsg.function === "get_widget_data" && fileDocs.length === 0) {
        const removedTables = invalidateEmptyWidgetFetchTables(toolMsg, ctx);
        const payload = stringifyToolData(toolMsg.data, 4_000);
        const staleTableNote = removedTables.length > 0
          ? `\n\nThe latest get_widget_data fetch returned no usable rows for the requested widget data. Stale table names removed from SQL state: ${removedTables.map((name) => `"${name}"`).join(", ")}. Do not query those stale tables for this filtered request.`
          : "\n\nThe latest get_widget_data fetch returned no usable rows for the requested widget data.";
        ctx.messages.push({
          role: "user" as const,
          content:
            "get_widget_data bridge result:\n\n" +
            `Input:\n${JSON.stringify(toolMsg.input_arguments ?? {}, null, 2)}\n\n` +
            `Output:\n${payload}` +
            staleTableNote,
        });
        logger.warn("get_widget_data returned no usable widget content", {
          inputArguments: toolMsg.input_arguments,
          outputPreview: stringifyToolData(toolMsg.data, 1_000),
          removedTables,
        });
        const noDataDetail =
          firstToolDataMessage(toolMsg.data) ??
          "The widget data bridge returned no usable rows, text, files, or media.";
        yield reasoningStep(
          "get_widget_data: no usable data returned",
          "WARNING",
          noDataDetail,
        );
        const terminalMessage = firstToolDataMessage(toolMsg.data)
          ? `The widget data request returned no usable data: ${noDataDetail}`
          : "No values were returned for the requested widget data.";
        return {
          terminal: true,
          terminalMessage,
          suppressWidgetDataTool: true,
          suppressWidgetDiscoveryTools: true,
        };
      }
      return {};
    }
  }
}
