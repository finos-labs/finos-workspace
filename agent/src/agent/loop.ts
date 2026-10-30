import {
  streamText,
  hasToolCall,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import type {
  AgentTool,
  Citation,
  CopilotArtifact,
  QueryRequest,
  SSEEvent,
  ToolMessage,
  Widget,
  WorkspaceState,
} from "../protocol/types.ts";
import {
  citationCollection,
  executeAgentTool,
  getSkillContent,
  getWidgetData,
  messageChunk,
  parseSuggestions,
  promptSuggestions,
  reasoningStep,
  streamingMessageChunk,
  stripPlaceholderTags,
  workspaceCommand,
} from "../protocol/events.ts";
import { makeTextSink, mergeMessageChunks } from "./text-sink.ts";
import { buildAllCitations, pagesNamedIn, type CitedWidget } from "../protocol/citations.ts";
import {
  activeToolNames,
  buildToolCatalog,
  groupsOfCalledTools,
  makeLoadToolsTool,
  type ToolCatalog,
} from "./tool-groups.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { applyParamOverrides, type TieredWidget } from "../widgets/tiers.ts";
import { extractWidgetItems, type WidgetItem } from "../widgets/parse.ts";
import { analyzeTable, sanitizeName, type TableInfo } from "../sql/loader.ts";
import { linkedToolName, makeMcpTools, type McpToolsResult } from "../mcp/factory.ts";
import { type McpCitation } from "../mcp/results.ts";
import { readExtraState } from "../protocol/extra-state.ts";
import { WORKSPACE_SERVER_ID } from "../protocol/workspace-server.ts";
import { buildMessages } from "./messages.ts";
import { injectFromReboot, injectSkill, injectWidgetData, type RoundTripContext } from "./round-trip.ts";
import { getCachedRows, getKeptWidgetData, keepWidgetData } from "./row-cache.ts";
import {
  formatToolInputRejectedStatus,
  formatToolResultStatus,
  formatToolStartStatus,
  formatWidgetDataLoadedStatuses,
  formatWidgetDataRequestStatuses,
} from "./tool-status.ts";
import { loadUploadedDocuments, buildDocumentsDecoration, type PendingDocument } from "./documents.ts";
import { prefetchUrls, urlCitationId } from "./url-prefetch.ts";
import { splitContext } from "./context.ts";
import { earlierEntries } from "./history.ts";
import { makeRecallConversationTool } from "./tools/recall-conversation.ts";
import { makeSearchWidgetsTool } from "./tools/search-widgets.ts";
import {
  makeWidgetDataTool,
  widgetDataSchema,
  type WidgetRequest,
} from "./tools/widget-data.ts";
import { makeGetSkillContentTool, getSkillContentSchema } from "./tools/skills.ts";
import { agentSkillContent, isAgentSkill } from "../skills/index.ts";
import { makeWorkspaceTools } from "./tools/workspace.ts";
import {
  normalizeBridgeArgs,
  SSE_BRIDGE_COMMANDS,
} from "../protocol/bridge-emit.ts";
import { makeSqlTools } from "./tools/sql/index.ts";
import { makeNativeTools } from "./tools/native.ts";
import { makeSuggestionsTool } from "./tools/suggestions.ts";
import { makeCreateAppTool } from "./tools/app-artifact.ts";
import {
  flattenUsage,
  accumulateUsage,
  cacheHitRate,
  readTurnUsage,
  ZERO_TURN_USAGE,
  ZERO_USAGE_COUNTS,
  type UsageCounts,
} from "../lib/token-usage.ts";
import { signScope, signUrl } from "../lib/scope.ts";
import { addressesGiven, isFetchTool, isGivenAddress } from "./known-urls.ts";
import { metrics } from "../lib/metrics.ts";
import { redactString } from "../lib/redact.ts";
import { liveDebugLevel } from "../lib/debug-traces.ts";
import { getLogger } from "../lib/logger.ts";
import { providerOptionsFor } from "../lib/providers.ts";
import {
  getTracer,
  parseTraceparent,
  contextFromSpanContext,
  formatTraceparent,
  traceIdForLogs,
  aiTelemetry,
} from "../lib/telemetry.ts";
import { context as otelContext, trace as otelTrace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { ATTR_SESSION_ID } from "@opentelemetry/semantic-conventions/incubating";

const logger = getLogger(["app", "agent", "loop"]);

export function _widgetCacheKey(uuid: string, inputArgs?: Record<string, unknown>): string {
  const sortedArgs = inputArgs
    ? Object.keys(inputArgs).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = inputArgs[k];
        return acc;
      }, {})
    : {};
  return JSON.stringify({ uuid, args: sortedArgs });
}

const widgetCacheKey = _widgetCacheKey;

function artifactPayloads(events: SSEEvent[]): CopilotArtifact[] {
  return events
    .filter((event) => event.event === "copilotMessageArtifact")
    .map((event) => event.data as unknown as CopilotArtifact);
}

function shouldRenderDetailAsCode(details: string): boolean {
  return ["```sql\n", "```html\n", "```mermaid\n"].some((prefix) =>
    details.startsWith(prefix),
  );
}

type ResolvedWidgetFetch = {
  request: WidgetRequest;
  widget: Widget;
  cacheInputArgs: Record<string, unknown>;
};

function effectiveWidgetInputArgs(
  widget: Widget,
  inputArgs?: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = inputArgs ? applyParamOverrides(widget, inputArgs) : widget;
  const args = Object.fromEntries(
    resolved.params.map((p) => [p.name, p.current_value ?? p.default_value]),
  );
  return {
    ...args,
    ...(inputArgs ?? {}),
  };
}

function buildDashboardNameByUuid(
  workspaceState: WorkspaceState | null,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const tab of workspaceState?.current_dashboard_info?.tabs ?? []) {
    for (const w of tab.widgets ?? []) {
      if (w.widget_uuid && w.name) map.set(w.widget_uuid, w.name);
    }
  }
  return map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function enrichToolStatusInput(
  toolName: string,
  input: unknown,
  dashboardNameByUuid: Map<string, string>,
): unknown {
  if (toolName !== "update_widget_in_dashboard" || !isRecord(input)) return input;
  if (typeof input.widget_name === "string" && input.widget_name.trim()) return input;
  const widgetUuid = typeof input.widget_uuid === "string" ? input.widget_uuid : undefined;
  const widgetName = widgetUuid ? dashboardNameByUuid.get(widgetUuid) : undefined;
  return widgetName ? { ...input, widget_name: widgetName } : input;
}

function resolveWidgetFetches(
  requests: WidgetRequest[],
  allWidgets: Widget[],
  dashboardNameByUuid: Map<string, string>,
): { fetches: ResolvedWidgetFetch[]; unmatched: string[] } {
  const fetches: ResolvedWidgetFetch[] = [];
  const unmatched: string[] = [];

  for (const req of requests) {
    let widget: Widget | undefined = allWidgets.find(
      (w) => w.uuid === req.widget_uuid,
    );
    if (!widget) {
      const dashboardName = dashboardNameByUuid.get(req.widget_uuid);
      if (dashboardName) {
        const byName = allWidgets.filter((w) => w.name === dashboardName);
        if (byName.length === 1) widget = byName[0];
      }
    }
    if (!widget) {
      unmatched.push(req.widget_uuid);
      continue;
    }

    const widgetUuid = widget.uuid ?? widget.widget_id;
    const inputArgs = req.input_args;
    const baseWidget = inputArgs ? applyParamOverrides(widget, inputArgs) : widget;
    const knownParamNames = new Set(baseWidget.params.map((p) => p.name));
    const extraParams = inputArgs
      ? Object.entries(inputArgs)
          .filter(([name]) => !knownParamNames.has(name))
          .map(([name, value]) => ({
            name,
            type: typeof value,
            description: "",
            current_value: value,
          }))
      : [];
    const resolvedWidget = extraParams.length > 0
      ? { ...baseWidget, params: [...baseWidget.params, ...extraParams] }
      : baseWidget;
    const cacheInputArgs = effectiveWidgetInputArgs(widget, inputArgs);
    fetches.push({
      request: {
        widget_uuid: widgetUuid,
        ...(inputArgs ? { input_args: inputArgs } : {}),
      },
      widget: resolvedWidget,
      cacheInputArgs,
    });
  }

  return { fetches, unmatched };
}

function logUnmatchedWidgets(
  unmatched: string[],
  allWidgets: Widget[],
): void {
  if (unmatched.length === 0) return;
  const sampleWidgetIds = allWidgets.slice(0, 5).map((w) => w.widget_id).join(", ");
  const fileWidgetNames = allWidgets
    .filter((w) => w.widget_id.startsWith("file-"))
    .map((w) => w.name);
  logger.warn(
    `Widget identifiers did not match any connected widget unmatched=[${unmatched.join(", ")}] totalAvailable=${allWidgets.length} fileWidgetNames=[${fileWidgetNames.join(" | ")}] sampleWidgetIds=[${sampleWidgetIds}]`,
    {
      unmatched,
      totalAvailable: allWidgets.length,
      fileWidgetNames,
      sampleWidgetIds: allWidgets.slice(0, 5).map((w) => w.widget_id),
    },
  );
}

function buildLoadedTablesInventory(
  pendingTables: Map<string, Record<string, unknown>[]>,
  allWidgets: Widget[] = [],
): string | null {
  if (pendingTables.size === 0) return null;
  const lines = [
    "## Already Loaded Queryable Tables",
    "These tables are already loaded for this conversation. Use `execute_sql`, `peek_table`, or `create_artifact` with these exact table names instead of calling `get_widget_data` again, unless required fields are missing. The listed columns and loaded-row coverage are authoritative; never invent columns or assume dates outside the loaded range. Alias exact columns when you need semantic names. Use display names, not queryable table names, in final answers.",
  ];
  const widgetDisplayByTableBase = allWidgets
    .map((widget) => ({ tableBase: sanitizeName(widget.name) || "data", displayName: widget.name }))
    .sort((a, b) => b.tableBase.length - a.tableBase.length);
  for (const [tableName, rows] of pendingTables) {
    if (rows.length === 0) continue;
    const table = analyzeTable(tableName, rows);
    const displayName = widgetDisplayByTableBase.find(
      (entry) => table.tableName === entry.tableBase || table.tableName.startsWith(`${entry.tableBase}_`),
    )?.displayName;
    const cols = table.columns
      .slice(0, 16)
      .map((col) => `"${col.name}" (${col.type})`)
      .join(", ");
    const more = table.columns.length > 16 ? `, ... ${table.columns.length - 16} more` : "";
    const coverage = loadedTableCoverage(rows, table.columns);
    lines.push(
      `- "${table.tableName}" (${displayName ? `display name: "${displayName}"; ` : ""}${table.rowCount} loaded rows${coverage ? `; loaded-row coverage: ${coverage}` : ""}): ${cols}${more}`,
    );
  }
  return lines.length > 2 ? lines.join("\n") : null;
}

function loadedTableCoverage(
  rows: Record<string, unknown>[],
  columns: { name: string; originalName: string; type: string }[],
): string | null {
  const temporalColumn =
    columns.find((column) => /^(date|datetime|timestamp|period)$/i.test(column.name)) ??
    columns.find((column) => /^year$/i.test(column.name));
  if (!temporalColumn) return null;

  const values = rows
    .map((row) => row[temporalColumn.originalName])
    .filter((value): value is string | number =>
      typeof value === "string" || typeof value === "number",
    )
    .map((value) => String(value).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (values.length === 0) return null;

  return `"${temporalColumn.name}" ${values[0]} to ${values[values.length - 1]}`;
}

function buildLoadedSkillsInventory(loadedSkillSlugs: Set<string>): string | null {
  if (loadedSkillSlugs.size === 0) return null;
  return [
    "## Already Loaded Skills",
    "These skill instructions are already loaded for this conversation.",
    ...[...loadedSkillSlugs].sort().map((slug) => `- ${slug}`),
  ].join("\n");
}

interface AgentRunOptions {
  request: QueryRequest;
  rawModelId: string;
  model: LanguageModel;
  allWidgets: Widget[];
  tieredWidgets?: TieredWidget[];
  workspaceState: WorkspaceState | null;
  conversationId: string;
  scopeSecret?: string | null;
  onUsage?: (usage: UsageCounts) => void;
  signal?: AbortSignal;
  disabledCapabilities?: readonly string[];
  promptSuggestionsEnabled?: boolean;
  suggestionsVia?: "inline" | "tool";
}

const READABLE_DOCUMENT_EXTENSIONS = new Set(["pdf", "docx"]);

function hasReadableDocumentWidget(request: QueryRequest): boolean {
  const widgets = [...(request.widgets?.primary ?? []), ...(request.widgets?.secondary ?? [])];
  return widgets.some((w) => {
    const ext = (w.metadata?.extension as string | undefined) ?? (w.metadata?.fileType as string | undefined);
    return ext ? READABLE_DOCUMENT_EXTENSIONS.has(ext.toLowerCase()) : false;
  }) || (request.documents?.length ?? 0) > 0;
}

const DOCUMENT_TOOL_CANONICAL = ["query_documents", "list_documents"] as const;

function isDocumentTool(toolName: string): boolean {
  return DOCUMENT_TOOL_CANONICAL.some(
    (canon) => toolName === canon || toolName.endsWith(`_${canon}`),
  );
}

const PAGE_TOOL_CANONICAL = ["fetch_webpage", "inspect_webpage"] as const;

function isPageTool(toolName: string): boolean {
  return PAGE_TOOL_CANONICAL.some(
    (canon) => toolName === canon || toolName.endsWith(`_${canon}`),
  );
}

const MAX_LOOPS = 3;

const LLM_STREAM_TIMEOUT_MS = Number(process.env.LLM_STREAM_TIMEOUT_MS) || 240_000;
const MAX_VISIBLE_MODEL_ERROR_CHARS = 1_000;
const LIVE_DEBUG_TRACES_LEVEL = liveDebugLevel();

function debugModelIo(payload: Record<string, unknown>): void {
  if (LIVE_DEBUG_TRACES_LEVEL < 2) return;
  console.error(
    "\n[LIVE_DEBUG_TRACES:model_io]\n" +
      JSON.stringify(payload, null, 2) +
      "\n[/LIVE_DEBUG_TRACES:model_io]\n",
  );
}

function debugMessageContent(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (!part || typeof part !== "object") return part;
      const record = part as Record<string, unknown>;
      if (record.type === "image" || record.type === "file") {
        return {
          ...record,
          data: typeof record.data === "string"
            ? `[${record.data.length} base64 chars omitted]`
            : record.data,
        };
      }
      return record;
    });
  }
  return content;
}

function debugMessages(messages: ModelMessage[]): unknown[] {
  return messages.map((m) => ({
    role: m.role,
    content: debugMessageContent((m as { content?: unknown }).content),
  }));
}

function toolErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function* runAgentLoop(options: AgentRunOptions): AsyncGenerator<SSEEvent> {
  const {
    request,
    rawModelId,
    model,
    allWidgets,
    workspaceState,
    promptSuggestionsEnabled = false,
    suggestionsVia = "inline",
    conversationId,
    scopeSecret = null,
    disabledCapabilities = [],
  } = options;
  const tieredWidgets: TieredWidget[] =
    options.tieredWidgets ?? allWidgets.map((w) => ({ widget: w, tier: "extra" as const }));

  const lastMessage = request.messages.at(-1);
  const isRebootToolTurn = lastMessage?.role === "tool";
  const hasWidgets = allWidgets.length > 0;
  const dashboardNameByUuid = buildDashboardNameByUuid(workspaceState);
  const agentTools = (request.tools ?? []) as AgentTool[];
  const mcpToolsResult: McpToolsResult | null =
    agentTools.length > 0 ? makeMcpTools(agentTools) : null;
  const linkedTool = (widget: Widget) => linkedToolName(widget.mcp_tool, mcpToolsResult?.entries ?? []);
  const earlierMessages = earlierEntries(request.messages);

  const artifactQueue: SSEEvent[] = [];
  let artifactIdx = 0;
  const tables: TableInfo[] = [];
  const citedWidgets = new Map<string, CitedWidget>();
  const mcpCitations: McpCitation[] = [];
  const intermediateCitations: Citation[] = [];
  const pendingTables = new Map<string, Record<string, unknown>[]>(
    await getCachedRows(conversationId, allWidgets),
  );
  if (pendingTables.size > 0) {
    logger.info("Seeded pendingTables from chat row cache", {
      conversationId,
      seedCount: pendingTables.size,
      seedNames: [...pendingTables.keys()],
    });
  }
  const documentsShipped = new Set<string>();
  const rebootExtra = isRebootToolTurn ? readExtraState(lastMessage as ToolMessage) : {};
  const loadedSkillSlugs = new Set<string>(
    (request.selected_skills ?? []).map((skill) => skill.slug),
  );
  if (isRebootToolTurn) {
    for (const slug of rebootExtra.loaded_skill_slugs ?? []) loadedSkillSlugs.add(slug);
    if (lastMessage.function === "get_skill_content") {
      const slug = lastMessage.input_arguments?.slug;
      if (typeof slug === "string" && slug) loadedSkillSlugs.add(slug);
    }
    for (const d of rebootExtra.documents_shipped ?? []) documentsShipped.add(d);
  }
  const loadedGroups = new Set<string>(isRebootToolTurn ? (rebootExtra.loaded_tool_groups ?? []).filter((g) => typeof g === "string") : []);

  const inheritedRoot = isRebootToolTurn ? parseTraceparent(rebootExtra.traceparent) : null;
  const turnTimezone = request.timezone ?? (isRebootToolTurn ? rebootExtra.timezone : undefined);
  const turnSpan: Span = getTracer().startSpan(
    "agent.turn.request",
    {
      attributes: {
        "agent.conversation_id": conversationId || "(missing)",
        ...(conversationId ? { [ATTR_SESSION_ID]: conversationId } : {}),
        "agent.model": rawModelId,
        "agent.reboot": isRebootToolTurn,
        "agent.reboot_function": isRebootToolTurn ? lastMessage.function : "",
        "agent.widget_count": allWidgets.length,
        "agent.mcp_tool_count": agentTools.length,
      },
    },
    inheritedRoot ? contextFromSpanContext(inheritedRoot) : undefined,
  );
  const turnSpanCtx = otelTrace.setSpan(otelContext.active(), turnSpan);
  const turnSpanContext = turnSpan.spanContext();
  const turnTraceparent =
    formatTraceparent(inheritedRoot ?? turnSpanContext) ?? undefined;
  const priorTurnUsage = isRebootToolTurn ? readTurnUsage(rebootExtra.turn_usage) : ZERO_TURN_USAGE;

  let cumulativeUsage = { ...ZERO_USAGE_COUNTS };
  let totalStepCount = 0;
  let loopCount = 0;

  function turnUsageSoFar() {
    return {
      inputTokens: priorTurnUsage.inputTokens + cumulativeUsage.inputTokens,
      cachedInputTokens: priorTurnUsage.cachedInputTokens + cumulativeUsage.cachedInputTokens,
      cacheWriteTokens: priorTurnUsage.cacheWriteTokens + cumulativeUsage.cacheWriteTokens,
      outputTokens: priorTurnUsage.outputTokens + cumulativeUsage.outputTokens,
      totalTokens: priorTurnUsage.totalTokens + cumulativeUsage.totalTokens,
      postCount: priorTurnUsage.postCount + 1,
    };
  }
  const pendingDocuments: Map<string, PendingDocument> = await loadUploadedDocuments(
    request.documents,
  );
  if ((request.documents?.length ?? 0) > 0) {
    logger.warn(
      "request.documents is deprecated — workspace should upload files as file-* widgets in widgets.primary; the agent now ingests them via the get_widget_data round-trip.",
      { count: request.documents!.length },
    );
  }

  try {
    const promptOptions = {
      promptSuggestionsEnabled,
      suggestionsVia,
      workspaceState,
      timezone: turnTimezone,
      disabledCapabilities,
      linkedTool,
    };
    const messages = buildMessages(request, promptOptions);

    const prefetched = disabledCapabilities.includes("FETCH_FROM_WEB") ? [] : await prefetchUrls(request.urls);
    for (const r of prefetched) {
      const id = await urlCitationId(r.url);
      mcpCitations.push({ id, type: "web", url: r.url, title: r.title });
    }

    const ctxSplit = splitContext(request.context);
    for (const t of ctxSplit.tables) {
      pendingTables.set(t.name, t.rows);
    }

    const contextSections: string[] = [];
    if (prefetched.length > 0) {
      contextSections.push("## Fetched URLs\n");
      for (const r of prefetched) {
        contextSections.push(
          `### ${r.title} — ${r.url}\n\n${r.overview}`,
        );
      }
    }
    if (ctxSplit.textBlocks.length > 0) {
      contextSections.push("\n## Conversation context (text)\n");
      for (const tb of ctxSplit.textBlocks) {
        const sub = tb.description ? ` — ${tb.description}` : "";
        contextSections.push(`### ${tb.name}${sub}\n\n${tb.text}`);
      }
    }
    if (ctxSplit.tables.length > 0) {
      contextSections.push("\n## Conversation context (tables loaded)\n");
      for (const t of ctxSplit.tables) {
        contextSections.push(
          `- ${t.name} (${t.rows.length} rows) — query with execute_sql`,
        );
      }
    }
    const loadedTablesInventory = buildLoadedTablesInventory(pendingTables, allWidgets);
    if (loadedTablesInventory) {
      contextSections.push(`\n${loadedTablesInventory}`);
    }
    const loadedSkillsInventory = buildLoadedSkillsInventory(loadedSkillSlugs);
    if (loadedSkillsInventory) {
      contextSections.push(`\n${loadedSkillsInventory}`);
    }
    if (contextSections.length > 0) {
      messages.push({
        role: "user" as const,
        content: contextSections.join("\n\n"),
      });
    }

    const ctx: RoundTripContext = {
      tables, messages, allWidgets,
      citedWidgets, mcpCitations, artifactQueue, intermediateCitations,
      pendingTables,
      conversationId,
      pendingDocuments,
      documentSearchAvailable:
        mcpToolsResult?.entries.some(
          (entry) =>
            entry.toolName === "query_documents" || entry.toolName.endsWith("_query_documents") ||
            entry.sanitizedName.endsWith("query_documents"),
        ) ?? false,
    };

    async function buildContinuationExtraState(): Promise<Record<string, unknown>> {
      const documentHits = mcpCitations.filter((c) => c.type === "document");
      const cits = await buildAllCitations(
        citedWidgets,
        mcpCitations.filter((c) => c.type !== "document"),
        intermediateCitations,
        allWidgets,
      );
      const extraState: Record<string, unknown> = {};
      if (cits.length > 0) extraState.intermediate_citations = cits;
      if (documentHits.length > 0) extraState.document_hits = documentHits;
      if (documentsShipped.size > 0) extraState.documents_shipped = [...documentsShipped];
      if (loadedSkillSlugs.size > 0) extraState.loaded_skill_slugs = [...loadedSkillSlugs];
      if (loadedGroups.size > 0) extraState.loaded_tool_groups = [...loadedGroups];
      if (turnTraceparent) extraState.traceparent = turnTraceparent;
      if (turnTimezone) extraState.timezone = turnTimezone;
      extraState.turn_usage = turnUsageSoFar();
      return extraState;
    }

    async function* emitNextWidgetFetch(
      fetches: ResolvedWidgetFetch[],
    ): AsyncGenerator<SSEEvent, boolean, unknown> {
      if (fetches.length === 0) return false;

      const extraState = await buildContinuationExtraState();
      for (const status of formatWidgetDataRequestStatuses(fetches.map((fetch) => fetch.widget))) {
        yield reasoningStep(status.message, status.eventType ?? "INFO", status.details, status.artifacts);
      }
      yield* emitPendingArtifactsBeforeExit();
      yield getWidgetData(fetches.map((fetch) => fetch.widget), extraState);
      return true;
    }

    let answerArtifactEmitted = false;
    const deferredAnswerArtifactEvents: SSEEvent[] = [];
    function* flushDeferredAnswerArtifacts(): Generator<SSEEvent> {
      while (deferredAnswerArtifactEvents.length > 0) {
        const queued = deferredAnswerArtifactEvents.shift()!;
        answerArtifactEmitted = true;
        yield queued;
      }
    }
    function* drainQueueToDeferred(): Generator<SSEEvent> {
      while (artifactIdx < artifactQueue.length) {
        const queued = artifactQueue[artifactIdx++];
        if (queued.event === "copilotMessageArtifact") {
          deferredAnswerArtifactEvents.push(queued);
        } else {
          yield queued;
        }
      }
    }
    function* emitPendingArtifactsBeforeExit(): Generator<SSEEvent> {
      yield* drainQueueToDeferred();
      yield* flushDeferredAnswerArtifacts();
    }

    const mcpToolNames = mcpToolsResult ? new Set(mcpToolsResult.entries.map((e) => e.sanitizedName)) : null;
    const mcpEntryBySanitized = mcpToolsResult
      ? new Map(mcpToolsResult.entries.map((entry) => [entry.sanitizedName, entry]))
      : null;

    let suppressWidgetDataToolForEmptyWidgetRetry = false;
    let suppressWidgetDiscoveryToolsForEmptyWidgetRetry = false;

    if (isRebootToolTurn) {
      const rebootOut = yield* injectFromReboot(lastMessage as ToolMessage, ctx);
      const queuedWorkspaceCalls = (rebootExtra.pending_workspace_calls ?? []).flatMap((call) => {
        const entry = mcpEntryBySanitized?.get(call.tool_name);
        return entry?.serverId === WORKSPACE_SERVER_ID ? [{ entry, parameters: call.input_arguments }] : [];
      });
      const hasQueuedContinuation =
        (rebootExtra.pending_bridge_calls?.length ?? 0) > 0 || queuedWorkspaceCalls.length > 0;
      if (rebootOut.terminal && !hasQueuedContinuation) {
        yield* emitPendingArtifactsBeforeExit();
        if (rebootOut.terminalMessage) {
          yield messageChunk(rebootOut.terminalMessage);
        }
        return;
      }
      suppressWidgetDataToolForEmptyWidgetRetry = rebootOut.suppressWidgetDataTool === true;
      suppressWidgetDiscoveryToolsForEmptyWidgetRetry =
        rebootOut.suppressWidgetDiscoveryTools === true;
      const queuedBridgeCalls = (rebootExtra.pending_bridge_calls ?? []).filter((c) =>
        SSE_BRIDGE_COMMANDS.has(c.function),
      );
      if (queuedWorkspaceCalls.length > 0) {
        const [next, ...remaining] = queuedWorkspaceCalls;
        const drainExtraState = await buildContinuationExtraState();
        if (remaining.length > 0) {
          drainExtraState.pending_workspace_calls = remaining.map(({ entry, parameters }) => ({
            tool_name: entry.sanitizedName,
            input_arguments: parameters,
          }));
        }
        logger.info("Draining queued FINOS Workspace call", {
          emitting: next.entry.toolName,
          remaining: remaining.map(({ entry }) => entry.toolName),
        });
        yield* emitPendingArtifactsBeforeExit();
        yield executeAgentTool(next.entry.serverId, next.entry.toolName, next.parameters, drainExtraState);
        return;
      }
      if (queuedBridgeCalls.length > 0) {
        const [next, ...remaining] = queuedBridgeCalls;
        const drainExtraState = await buildContinuationExtraState();
        if (remaining.length > 0) drainExtraState.pending_bridge_calls = remaining;
        logger.info("Draining queued bridge call", {
          emitting: next.function,
          remaining: remaining.map((c) => c.function),
        });
        yield* emitPendingArtifactsBeforeExit();
        yield workspaceCommand(
          next.function,
          normalizeBridgeArgs(next.function, next.input_arguments ?? {}),
          drainExtraState,
        );
        return;
      }
    }

    let createArtifactReasoningEmitted = false;
    const sink = makeTextSink({
      deferredAnswerArtifactEvents,
      onArtifactEmitted: () => {
        answerArtifactEmitted = true;
      },
    });
    let capturedSuggestions: string[] = [];
    function visibleModelFailureMessage(errorText: string, isTimeout = false): string {
      const safeError = redactString(errorText);
      const conciseError = safeError.length <= MAX_VISIBLE_MODEL_ERROR_CHARS
        ? safeError
        : `${safeError.slice(0, MAX_VISIBLE_MODEL_ERROR_CHARS)}...`;
      return isTimeout
        ? "I couldn't finish the response because the model timed out. Try a narrower request."
        : `I couldn't finish the response because the model returned an error: ${conciseError}`;
    }
    let suppressWidgetDataToolForCachedRetry = false;
    const searchTool = makeSearchWidgetsTool(tieredWidgets, linkedTool);
    const createAppTool = makeCreateAppTool({ allWidgets, artifactQueue });

    for (let loopIdx = 0; loopIdx < MAX_LOOPS; loopIdx++) {
      yield* drainQueueToDeferred();

      const workspaceToolSet =
        !suppressWidgetDiscoveryToolsForEmptyWidgetRetry &&
        !mcpToolsResult?.workspaceToolsOffered
          ? makeWorkspaceTools(SSE_BRIDGE_COMMANDS)
          : null;
      const sqlToolSet = makeSqlTools({
        pendingTables,
        artifactQueue,
      });
      const nativeToolSet = makeNativeTools({
        pendingTables,
        artifactQueue,
        tables,
        conversationId,
      });
      const widgetDataToolEnabled =
        hasWidgets &&
        !mcpToolsResult?.widgetDataEntry &&
        !suppressWidgetDataToolForCachedRetry &&
        !suppressWidgetDataToolForEmptyWidgetRetry &&
        !suppressWidgetDiscoveryToolsForEmptyWidgetRetry;
      const widgetDiscoveryToolsEnabled = !suppressWidgetDiscoveryToolsForEmptyWidgetRetry;
      if (suppressWidgetDataToolForCachedRetry) {
        logger.info("Suppressing get_widget_data after cache-resolved injection", { loopIdx });
      }
      if (suppressWidgetDataToolForEmptyWidgetRetry) {
        logger.info("Suppressing get_widget_data after empty widget-data result", { loopIdx });
      }
      if (suppressWidgetDiscoveryToolsForEmptyWidgetRetry) {
        logger.info("Suppressing widget discovery tools after empty widget-data result", { loopIdx });
      }
      suppressWidgetDataToolForCachedRetry = false;
      suppressWidgetDataToolForEmptyWidgetRetry = false;
      suppressWidgetDiscoveryToolsForEmptyWidgetRetry = false;

      const allTools: ToolSet = {
        ...(widgetDiscoveryToolsEnabled && { search_widgets: searchTool }),
        ...(widgetDiscoveryToolsEnabled && { create_app: createAppTool }),
        ...sqlToolSet,
        ...nativeToolSet,
        ...(widgetDataToolEnabled && { get_widget_data: makeWidgetDataTool() }),
        get_skill_content: makeGetSkillContentTool(),
        ...(earlierMessages.length > 0 && { recall_conversation: makeRecallConversationTool(earlierMessages) }),
        ...(suggestionsVia === "tool" &&
          promptSuggestionsEnabled && {
            suggest_followups: makeSuggestionsTool({
              setSuggestions: (s) => {
                capturedSuggestions = s;
              },
            }),
          }),
        ...mcpToolsResult?.toolSet,
        ...(workspaceToolSet ?? {}),
      };

      const catalog: ToolCatalog = buildToolCatalog(Object.keys(allTools), mcpToolsResult?.entries ?? []);
      const tools: ToolSet =
        catalog.groups.some((g) => !g.always)
          ? { ...allTools, load_tools: makeLoadToolsTool({ catalog, loaded: loadedGroups }) }
          : allTools;
      const exposedGroups = (): Set<string> => {
        const exposed = new Set(loadedGroups);
        if (tables.length > 0 || pendingTables.size > 0) exposed.add("sql");
        if (
          (ctx.pendingDocuments?.size ?? 0) > 0 ||
          documentsShipped.size > 0 ||
          hasReadableDocumentWidget(request)
        ) {
          exposed.add("documents");
        }
        return exposed;
      };

      if (loopIdx === 0) {
        logger.info("Tools available", {
          tools: Object.keys(allTools),
          deferredGroups: catalog.groups.map((g) => g.id),
          mcpCount: agentTools.length,
        });
      }
      const result = otelContext.with(turnSpanCtx, () => streamText({
        model,
        messages,
        tools,
        prepareStep: ({ steps, messages: stepMessages }) => {
          for (const group of groupsOfCalledTools(catalog, steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)))) {
            loadedGroups.add(group);
          }
          const exposed = exposedGroups();
          const system = buildSystemPrompt(request, {
            ...promptOptions,
            toolCatalog: catalog,
            loadedGroups: exposed,
          });
          return {
            activeTools: activeToolNames(catalog, Object.keys(tools), exposed),
            messages: [
              { role: "system" as const, content: system },
              ...(stepMessages[0]?.role === "system" ? stepMessages.slice(1) : stepMessages),
            ],
          };
        },
        stopWhen: [
          ...(widgetDataToolEnabled ? [hasToolCall("get_widget_data")] : []),
          hasToolCall("get_skill_content"),
          ...(workspaceToolSet
            ? Array.from(SSE_BRIDGE_COMMANDS).map((name) => hasToolCall(name))
            : []),
          ...(mcpToolsResult ? [mcpToolsResult.stopCondition] : []),
          stepCountIs(15),
        ],
        providerOptions: providerOptionsFor(conversationId || undefined),
        abortSignal: options.signal
          ? AbortSignal.any([AbortSignal.timeout(LLM_STREAM_TIMEOUT_MS), options.signal])
          : AbortSignal.timeout(LLM_STREAM_TIMEOUT_MS),
        onError: ({ error }) => {
          metrics.modelErrors.inc({ provider: rawModelId.split(":")[0] });
          logger.error("streamText error part", { loopIdx, error });
        },
        experimental_telemetry: aiTelemetry("agent.loop", {
          conversation_id: conversationId || undefined,
          model: rawModelId,
          loop_idx: loopIdx,
        }),
      }));

      const reasoningByBlock = new Map<string, string>();
      let lastReasoningEmitted = "";
      let aborted = false;
      const invalidToolCallIds = new Set<string>();
      let pendingText = "";
      let stepHasToolCall = false;
      function* showPendingText(): Generator<SSEEvent> {
        const text = pendingText;
        pendingText = "";
        if (!text.trim()) return;
        if (stepHasToolCall) {
          const shown = stripPlaceholderTags(parseSuggestions(text).cleanText).trim();
          if (shown.length >= 15 && shown !== lastReasoningEmitted) {
            lastReasoningEmitted = shown;
            yield reasoningStep(shown, "INFO");
          }
          return;
        }
        for (const ev of mergeMessageChunks(sink.pushDelta(text))) yield ev;
      }
      function* emitVisibleModelFailure(errorText: string, isTimeout = false): Generator<SSEEvent> {
        yield* drainQueueToDeferred();
        yield* showPendingText();
        for (const ev of sink.flushTail()) yield ev;
        const fallback = visibleModelFailureMessage(errorText, isTimeout);
        yield messageChunk(sink.textEmitted ? `\n\n${fallback}` : fallback);
      }
      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case "start-step":
              stepHasToolCall = false;
              break;
            case "text-delta":
              pendingText += part.text;
              break;
            case "text-end":
              if (stepHasToolCall) yield* showPendingText();
              break;
            case "finish-step":
              yield* showPendingText();
              break;
            case "reasoning-delta":
              reasoningByBlock.set(part.id, (reasoningByBlock.get(part.id) ?? "") + part.text);
              break;
            case "reasoning-end": {
              const text = (reasoningByBlock.get(part.id) ?? "").trim();
              reasoningByBlock.delete(part.id);
              if (text.length >= 15 && text !== lastReasoningEmitted) {
                lastReasoningEmitted = text;
                yield reasoningStep(text, "INFO");
              }
              break;
            }
            case "tool-call": {
              if (!stepHasToolCall) {
                stepHasToolCall = true;
                yield* showPendingText();
              }
              if (part.invalid) {
                invalidToolCallIds.add(part.toolCallId);
                const errorText = toolErrorText(part.error);
                logger.warn("Tool input rejected by schema", {
                  loopIdx,
                  toolName: part.toolName,
                  toolCallId: part.toolCallId,
                  input: part.input,
                  error: errorText,
                });
                const status = formatToolInputRejectedStatus(part.toolName, part.input, errorText);
                yield reasoningStep(status.message, status.eventType ?? "WARNING", status.details);
                break;
              }
              if (part.toolName === "get_widget_data" || part.toolName === "_llm_think") {
                break;
              }
              const isMcp = mcpToolNames?.has(part.toolName) ?? false;
              const mcpEntry = isMcp ? mcpEntryBySanitized?.get(part.toolName) : undefined;
              const statusInput = enrichToolStatusInput(part.toolName, part.input, dashboardNameByUuid);
              const status = formatToolStartStatus(part.toolName, statusInput, {
                isMcp,
                actualToolName: mcpEntry?.toolName,
              });
              const displayDetail: Record<string, unknown> | string | undefined =
                status.details && typeof status.details === "object" && !Array.isArray(status.details)
                  ? "detail" in status.details
                    ? { detail: status.details.detail }
                    : status.details
                  : typeof status.details === "string"
                    ? shouldRenderDetailAsCode(status.details)
                      ? status.details
                      : { detail: status.details }
                    : undefined;
              const event = reasoningStep(
                status.message,
                status.eventType ?? "INFO",
                displayDetail,
                status.artifacts,
              );
              event.data.tool_call = { tool_name: part.toolName, input: part.input };
              yield event;
              break;
            }
            case "tool-result": {
              const queuedArtifactEvents: SSEEvent[] = [];
              while (artifactIdx < artifactQueue.length) {
                const queued = artifactQueue[artifactIdx++];
                if (queued.event === "copilotMessageArtifact") {
                  queuedArtifactEvents.push(queued);
                } else {
                  yield queued;
                }
              }
              if (part.toolName === "_llm_think") {
                for (const queued of queuedArtifactEvents) {
                  answerArtifactEmitted = true;
                  yield queued;
                }
                break;
              }
              const isMcp = mcpToolNames?.has(part.toolName) ?? false;
              const mcpEntry = isMcp ? mcpEntryBySanitized?.get(part.toolName) : undefined;
              const status = formatToolResultStatus(part.toolName, part.input, part.output, {
                isMcp,
                actualToolName: mcpEntry?.toolName,
              });
              const statusArtifacts = status.artifacts ?? [];
              const artifacts = [
                ...statusArtifacts,
                ...artifactPayloads(queuedArtifactEvents),
              ];
              if (part.toolName === "create_artifact" && artifacts.length > 0) {
                createArtifactReasoningEmitted = true;
              }
              if (!status.generic || artifacts.length > 0) {
                yield reasoningStep(
                  status.message,
                  status.eventType ?? "INFO",
                  artifacts.length > 0 ? undefined : status.details,
                  artifacts,
                );
              }
              if (part.toolName === "create_artifact") {
                deferredAnswerArtifactEvents.push(...queuedArtifactEvents);
              } else {
                for (const queued of queuedArtifactEvents) {
                  answerArtifactEmitted = true;
                  yield queued;
                }
              }
              break;
            }
            case "tool-error": {
              if (invalidToolCallIds.has(part.toolCallId)) break;
              const errorText = toolErrorText(part.error);
              logger.warn("Tool execution failed", {
                loopIdx,
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                input: part.input,
                error: errorText,
              });
              yield reasoningStep("Tool execution failed", "WARNING", {
                phase: "output",
                category: "tool_output",
                tool_name: part.toolName,
                input_params: part.input,
                output_preview: errorText,
              });
              break;
            }
            case "error": {
              const errorText = toolErrorText(part.error);
              logger.error("streamText error part", { loopIdx, error: errorText });
              yield reasoningStep(`Model error: ${errorText}`, "ERROR");
              yield* emitVisibleModelFailure(errorText);
              return;
            }
            case "abort":
              aborted = true;
              break;
          }
          while (
            artifactIdx < artifactQueue.length &&
            artifactQueue[artifactIdx].event !== "copilotMessageArtifact"
          ) {
            yield artifactQueue[artifactIdx++];
          }
        }
        yield* showPendingText();
      } catch (err) {
        const isAbort =
          err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
        logger.error("streamText consumption failed", {
          loopIdx,
          isAbort,
          error: err instanceof Error ? err.message : String(err),
        });
        yield reasoningStep(
          isAbort
            ? `Model timed out after ${Math.round(LLM_STREAM_TIMEOUT_MS / 1000)}s. Try a narrower request.`
            : `Model error: ${err instanceof Error ? err.message : String(err)}`,
          "ERROR",
        );
        yield* emitVisibleModelFailure(
          err instanceof Error ? err.message : String(err),
          isAbort,
        );
        return;
      }
      if (aborted) {
        logger.warn("streamText aborted (timeout)", { loopIdx, timeoutMs: LLM_STREAM_TIMEOUT_MS });
        yield reasoningStep(
          `Model timed out after ${Math.round(LLM_STREAM_TIMEOUT_MS / 1000)}s. Try a narrower request.`,
          "ERROR",
        );
        yield* emitVisibleModelFailure(
          `Model timed out after ${Math.round(LLM_STREAM_TIMEOUT_MS / 1000)}s.`,
          true,
        );
        return;
      }

      const steps = await result.steps;
      metrics.modelCalls.inc({ provider: rawModelId.split(":")[0] }, steps.length);
      const totalUsage = await result.totalUsage;
      const finalText = await result.text;
      const debugStepRecords = steps as unknown as Array<Record<string, unknown>>;
      debugModelIo({
        loopIdx,
        modelId: rawModelId,
        messages: debugMessages(messages),
        toolCalls: steps.flatMap((step) =>
          step.toolCalls.map((tc) => ({
            toolName: tc.toolName,
            input: tc.input,
          })),
        ),
        finalText,
        reasoning: debugStepRecords
          .map((step, idx) => ({
            step: idx,
            reasoningText: step.reasoningText ?? null,
            reasoning: step.reasoning ?? null,
          }))
          .filter((step) => step.reasoningText != null || step.reasoning != null),
        usage: totalUsage,
      });

      const loopUsage = flattenUsage(totalUsage);
      cumulativeUsage = accumulateUsage(cumulativeUsage, loopUsage);
      totalStepCount += steps.length;
      loopCount++;

      logger.info("Loop complete", { loopIdx, steps: steps.length, ...loopUsage });

      const lastStep = steps.at(-1);
      const completedToolNames = Array.from(
        new Set(steps.flatMap((step) => step.toolCalls.map((tc) => tc.toolName))),
      );

      const turnUsage = turnUsageSoFar();
      logger.info("Token usage", {
        conversationId: conversationId || "(missing)",
        traceId: traceIdForLogs(turnSpanContext),
        modelId: rawModelId,
        ...cumulativeUsage,
        cacheHitRate: cacheHitRate(cumulativeUsage),
        loopCount,
        stepCount: totalStepCount,
        turnInputTokens: turnUsage.inputTokens,
        turnCachedInputTokens: turnUsage.cachedInputTokens,
        turnCacheWriteTokens: turnUsage.cacheWriteTokens,
        turnCacheHitRate: cacheHitRate(turnUsage),
        turnOutputTokens: turnUsage.outputTokens,
        turnTotalTokens: turnUsage.totalTokens,
        turnPostCount: turnUsage.postCount,
      });

      while (artifactIdx < artifactQueue.length) {
        const queued = artifactQueue[artifactIdx++];
        if (queued.event === "copilotMessageArtifact") {
          deferredAnswerArtifactEvents.push(queued);
        } else {
          yield queued;
        }
      }

      const mcpToolCall = mcpToolsResult
        ? lastStep?.toolCalls.find((tc) => mcpToolNames!.has(tc.toolName))
        : undefined;

      if (mcpToolCall) {
        const entry = mcpToolsResult!.entries.find((e) => e.sanitizedName === mcpToolCall.toolName)!;
        const params = { ...((mcpToolCall.input ?? {}) as Record<string, unknown>) };
        delete params.display_summary;

        if (isDocumentTool(entry.toolName)) {
          if (!conversationId) {
            logger.warn(
              `${entry.toolName} called without X-Trace-Id — doc store keying will fail`,
            );
          }
          params["x-agent-conversation-id"] = conversationId;
          if (scopeSecret) params["x-agent-scope-sig"] = signScope(scopeSecret, conversationId);
          const docDelta = buildDocumentsDecoration(pendingDocuments, documentsShipped);
          if (docDelta) {
            params["x-agent-documents"] = docDelta;
            for (const d of docDelta) documentsShipped.add(d.id);
          }
          logger.info(
            `Doc decoration tool=${entry.toolName} pending=${pendingDocuments.size} shipping=${docDelta?.length ?? 0} alreadyShipped=${documentsShipped.size - (docDelta?.length ?? 0)}`,
            {
              tool: entry.toolName,
              conversationId,
              pendingDocCount: pendingDocuments.size,
              shippingIds: docDelta?.map((d) => d.id) ?? [],
            },
          );
        }

        if (isPageTool(entry.toolName)) {
          if (conversationId) {
            params["x-agent-conversation-id"] = conversationId;
            if (scopeSecret) params["x-agent-scope-sig"] = signScope(scopeSecret, conversationId);
          } else {
            delete params["x-agent-conversation-id"];
            delete params["x-agent-scope-sig"];
          }
        }

        if (isFetchTool(entry.toolName) && scopeSecret) {
          const url = params.url;
          if (typeof url === "string" && isGivenAddress(url, addressesGiven(request, prefetched.map((page) => page.overview)))) {
            params["x-agent-url-sig"] = signUrl(scopeSecret, url);
          } else {
            delete params["x-agent-url-sig"];
          }
        }

        const extraState = await buildContinuationExtraState();

        const paramsBytes = Buffer.byteLength(JSON.stringify(params), "utf-8");
        logger.info("Emitting executeAgentTool", {
          conversationId,
          tool: entry.toolName,
          serverId: entry.serverId,
          paramsKeys: Object.keys(params),
          paramsBytes,
          extraStateKeys: Object.keys(extraState),
        });

        if (entry.serverId === WORKSPACE_SERVER_ID) {
          const queued = (lastStep?.toolCalls ?? []).flatMap((call) => {
            if (call === mcpToolCall || mcpEntryBySanitized?.get(call.toolName)?.serverId !== WORKSPACE_SERVER_ID) return [];
            const { display_summary: _summary, ...input } = (call.input ?? {}) as Record<string, unknown>;
            return [{ tool_name: call.toolName, input_arguments: input }];
          });
          if (queued.length > 0) {
            extraState.pending_workspace_calls = queued;
            logger.info("Queueing extra FINOS Workspace calls for sequential drain", {
              emitted: entry.toolName,
              queued: queued.map((call) => call.tool_name),
            });
          }
        }

        for (const ev of sink.flushTail()) yield ev;
        yield* emitPendingArtifactsBeforeExit();
        yield executeAgentTool(entry.serverId, entry.toolName, params, extraState);
        return;
      }

      const bridgeCalls =
        workspaceToolSet
          ? (lastStep?.toolCalls.filter((tc) =>
              SSE_BRIDGE_COMMANDS.has(tc.toolName),
            ) ?? [])
          : [];
      if (bridgeCalls.length > 0) {
        for (const ev of sink.flushTail()) yield ev;
        yield* emitPendingArtifactsBeforeExit();
        const [bridgeCall, ...deferred] = bridgeCalls;
        const bridgeExtraState = await buildContinuationExtraState();
        if (deferred.length > 0) {
          bridgeExtraState.pending_bridge_calls = deferred.map((tc) => ({
            function: tc.toolName,
            input_arguments: (tc.input ?? {}) as Record<string, unknown>,
          }));
          logger.info("Queueing extra bridge calls for sequential drain", {
            emitted: bridgeCall.toolName,
            queued: deferred.map((tc) => tc.toolName),
          });
        }
        yield workspaceCommand(
          bridgeCall.toolName,
          normalizeBridgeArgs(
            bridgeCall.toolName,
            (bridgeCall.input ?? {}) as Record<string, unknown>,
          ),
          bridgeExtraState,
        );
        return;
      }

      const skillCall = lastStep?.toolCalls.find((tc) => tc.toolName === "get_skill_content");
      if (skillCall) {
        const skillParsed = getSkillContentSchema.safeParse(skillCall.input);
        if (!skillParsed.success) {
          const issue = skillParsed.error.issues[0];
          const issuePath = issue.path.join(".") || "(root)";
          const errMsg = `get_skill_content arguments invalid at ${issuePath}: ${issue.message}. Expected shape: { slug: string, reason?: string }.`;
          logger.warn(`get_skill_content input rejected by schema: ${errMsg}`);
          const status = formatToolInputRejectedStatus("get_skill_content", skillCall.input, issue.message);
          yield reasoningStep(status.message, status.eventType ?? "WARNING", status.details);
          yield messageChunk(errMsg);
          return;
        }
        const { slug, reason } = skillParsed.data;
        loadedSkillSlugs.add(slug);
        if (isAgentSkill(request, slug)) {
          yield injectSkill(slug, agentSkillContent(slug), ctx);
          continue;
        }
        for (const ev of sink.flushTail()) yield ev;
        yield* emitPendingArtifactsBeforeExit();
        yield getSkillContent(slug, reason, await buildContinuationExtraState());
        return;
      }

      const widgetCall = lastStep?.toolCalls.find((tc) => tc.toolName === "get_widget_data");
      if (!widgetCall) {
        for (const ev of sink.flushTail()) yield ev;
        const { cleanTail, suggestions } = sink.takeSuggestions();
        if (cleanTail) yield streamingMessageChunk(cleanTail);
        const shownAnswer = sink.text + cleanTail;
        const terminalToolStop =
          !sink.textEmitted &&
          cleanTail.length === 0 &&
          !answerArtifactEmitted &&
          !createArtifactReasoningEmitted &&
          completedToolNames.length > 0;
        if (terminalToolStop) {
          const toolNames = completedToolNames;
          logger.warn("Model stopped after tool calls without final text or round-trip", {
            loopIdx,
            toolNames,
          });
          yield messageChunk(
            `I ran ${toolNames.map((name) => `\`${name}\``).join(", ")}, but the model stopped before composing a final answer.`,
          );
          yield reasoningStep(
            "Model stopped after tool output without a follow-up action.",
            "WARNING",
            { tool_calls: toolNames },
          );
        }
        const all = await buildAllCitations(citedWidgets, mcpCitations, intermediateCitations, allWidgets, shownAnswer);
        const shouldEmitCitations = all.length > 0 && !terminalToolStop;
        const documentPages = mcpCitations.flatMap((c) => (c.type === "document" && c.page != null ? [c.page] : []));
        logger.info(
          `Citations emission citedWidgets=${citedWidgets.size} mcp=${mcpCitations.length} intermediate=${intermediateCitations.length} totalAfterDedup=${all.length} willEmit=${shouldEmitCitations}`,
          {
            documentPagesReturned: documentPages,
            documentPagesNamed: [...pagesNamedIn(shownAnswer)],
            citedPages: all.flatMap((c) => c.details.flatMap((d) => (d.Page != null ? [d.Page] : []))),
            citedWidgetsSize: citedWidgets.size,
            mcpCitsCount: mcpCitations.length,
            intermediateCount: intermediateCitations.length,
            totalAfterDedup: all.length,
            suppressedForTerminalToolStop: terminalToolStop,
          },
        );
        if (shouldEmitCitations) yield citationCollection({ citations: all });
        const finalSuggestions = suggestionsVia === "tool" ? capturedSuggestions : suggestions;
        if (promptSuggestionsEnabled && finalSuggestions.length > 0) {
          yield promptSuggestions(finalSuggestions);
        }
        return;
      }

      const parsed = widgetDataSchema.safeParse(widgetCall.input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const issuePath = issue.path.join(".") || "(root)";
        const errMsg = `get_widget_data arguments invalid at ${issuePath}: ${issue.message}. Expected shape: { widgets: [{ widget_uuid: string, input_args?: object }] }.`;
        const statusMsg = `${issuePath}: ${issue.message}`;
        logger.warn(`get_widget_data input rejected by schema: ${errMsg}`);
        const status = formatToolInputRejectedStatus("get_widget_data", widgetCall.input, statusMsg);
        yield reasoningStep(status.message, status.eventType ?? "WARNING", status.details);
        yield messageChunk(errMsg);
        return;
      }
      const { widgets: widgetRequests } = parsed.data;
      const requestedUuidsStr = widgetRequests.map((r) => r.widget_uuid).join(", ");
      logger.info(
        `Widget data requested count=${widgetRequests.length} uuids=[${requestedUuidsStr}]`,
        { count: widgetRequests.length, requestedUuids: widgetRequests.map((r) => r.widget_uuid) },
      );

      const cachedItems: WidgetItem[] = [];
      const uncachedFetches: ResolvedWidgetFetch[] = [];
      const { fetches, unmatched } = resolveWidgetFetches(
        widgetRequests,
        allWidgets,
        dashboardNameByUuid,
      );
      logUnmatchedWidgets(unmatched, allWidgets);

      const seenFetchKeys = new Set<string>();
      for (const fetch of fetches) {
        const key = widgetCacheKey(fetch.request.widget_uuid, fetch.cacheInputArgs);
        if (seenFetchKeys.has(key)) continue;
        seenFetchKeys.add(key);
        const cached = await getKeptWidgetData(conversationId, key);
        if (cached) {
          cachedItems.push(...cached);
        } else {
          uncachedFetches.push(fetch);
        }
      }

      if (cachedItems.length > 0) {
        const knownTables = new Set(tables.map((table) => table.tableName));
        injectWidgetData(cachedItems, ctx);
        const newTables = tables.filter((table) => !knownTables.has(table.tableName));
        const statuses = formatWidgetDataLoadedStatuses(cachedItems, newTables, {
          cached: true,
          tableRows: ctx.pendingTables,
        });
        for (const status of statuses) {
          yield reasoningStep(status.message, status.eventType ?? "INFO", status.details, status.artifacts);
        }
      }

      if (uncachedFetches.length > 0) {
        for (const ev of sink.flushTail()) yield ev;
        if (yield* emitNextWidgetFetch(uncachedFetches)) return;
        continue;
      }

      if (fetches.length === 0) {
        logger.warn("No matching widgets found for request");
        for (const ev of sink.flushTail()) yield ev;
        if (!sink.textEmitted) yield messageChunk("I couldn't find the requested widgets.");
        return;
      }

      logger.info("All widgets resolved from cache", { count: widgetRequests.length });
      messages.push({
        role: "user" as const,
        content:
          "The requested widget data is already loaded and has been injected above. " +
          "Do not call get_widget_data again for the same widgets. Use execute_sql, peek_table, create_artifact, or answer from the loaded tables now.",
      });
      suppressWidgetDataToolForCachedRetry = true;
      continue;
    }

    logger.warn("Agent loop exhausted without producing a final answer", {
      loopCount,
      totalStepCount,
    });
    yield reasoningStep(
      "Stopped after repeated tool planning without a final answer.",
      "WARNING",
      { loop_count: loopCount, step_count: totalStepCount },
    );
    yield messageChunk(
      "I loaded the available data, but the model kept requesting widget data instead of composing an answer.",
    );

  } catch (err) {
    turnSpan.recordException(err instanceof Error ? err : new Error(String(err)));
    turnSpan.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    const turnUsage = turnUsageSoFar();
    turnSpan.setAttributes({
      "agent.loop_count": loopCount,
      "agent.step_count": totalStepCount,
      "agent.usage.request.input_tokens": cumulativeUsage.inputTokens,
      "agent.usage.request.cached_input_tokens": cumulativeUsage.cachedInputTokens,
      "agent.usage.request.cache_write_tokens": cumulativeUsage.cacheWriteTokens,
      "agent.usage.request.cache_hit_rate": cacheHitRate(cumulativeUsage),
      "agent.usage.request.output_tokens": cumulativeUsage.outputTokens,
      "agent.usage.turn.input_tokens": turnUsage.inputTokens,
      "agent.usage.turn.cached_input_tokens": turnUsage.cachedInputTokens,
      "agent.usage.turn.cache_write_tokens": turnUsage.cacheWriteTokens,
      "agent.usage.turn.cache_hit_rate": cacheHitRate(turnUsage),
      "agent.usage.turn.output_tokens": turnUsage.outputTokens,
      "agent.usage.turn.total_tokens": turnUsage.totalTokens,
      "agent.usage.turn.post_count": turnUsage.postCount,
    });
    turnSpan.end();
    try {
      options.onUsage?.(cumulativeUsage);
    } catch (error) {
      logger.warn("Reporting the usage of a request failed", { error });
    }
  }
}

export async function cacheWidgetItemsFromReboot(
  toolMsg: ToolMessage,
  allWidgets: Widget[],
  scope: string,
): Promise<WidgetItem[]> {
  const items = await extractWidgetItems(toolMsg, allWidgets);
  const queries = (toolMsg.input_arguments?.data_sources as Array<{
    widget_uuid: string;
    input_args?: Record<string, unknown>;
  }>) ?? [];
  for (let i = 0; i < items.length; i++) {
    const query = queries[i];
    const widget = items[i].widget ?? allWidgets.find((w) => w.uuid === items[i].uuid);
    const inputArgs = widget
      ? effectiveWidgetInputArgs(widget, query?.input_args)
      : query?.input_args;
    await keepWidgetData(scope, widgetCacheKey(items[i].uuid, inputArgs), [items[i]]);
  }
  return items;
}
