import { MAX_INLINE_TEXT_CHARS, MAX_TOOL_RESULT_CHARS } from "../../src/agent/clip.ts";
import { MAX_CACHED_TABLE_ROWS, ROWS_TTL_SECONDS, WIDGET_DATA_TTL_SECONDS } from "../../src/agent/row-cache.ts";
import { CORE_TOOLS, STATIC_GROUPS } from "../../src/agent/tool-groups.ts";
import { MAX_STATUS_TABLE_ROWS } from "../../src/agent/tool-status.ts";
import { MAX_SQL_TABLE_ROWS } from "../../src/agent/tools/sql/db.ts";
import { DEFAULT_MAX_BYTES, MAX_REDIRECTS } from "../../src/lib/safe-fetch.ts";
import { HISTORY_RENDER_MAX_CHARS, TYPED_ITEM_KINDS } from "../../src/mcp/results.ts";
import { MAX_TOKEN_CHARS, REJECTED_SECONDS, SIGN_IN_MAX_CONCURRENT, SIGN_IN_MAX_WAITING } from "../../src/auth/middleware.ts";
import { TURN_SECONDS } from "../../src/auth/limits.ts";
import { CONTEXT_TEXT_BLOCK_MAX_CHARS } from "../../src/agent/context.ts";
import { SEARCH_RESULT_CAP } from "../../src/agent/tools/search-widgets.ts";
import { MIN_SECRET_CHARS } from "../../mcp-server/src/lib/scope-check.ts";
import { CITED_SCORE_SHARE, MAX_CITED_PAGES } from "../../src/protocol/citations.ts";
import { WORKSPACE_BRIDGE_COMMANDS } from "../../src/protocol/bridge-commands.ts";
import { EXTRA_STATE_KEYS } from "../../src/protocol/extra-state.ts";
import { SSE_EVENT_TYPES, type SSEEventType } from "../../src/protocol/types.ts";
import { TYPE_SAMPLE_LIMIT } from "../../src/sql/loader.ts";
import { MAX_IMAGE_B64_CHARS, URL_DOWNLOAD_TIMEOUT_MS, XLSX_TIMEOUT_MS } from "../../src/widgets/parse.ts";
import { QueryRequestSchema, WidgetSchema } from "../../src/routes/query.ts";
import { type SchemaField, schemaFields } from "./schema.ts";

export interface BridgeCommandEntry {
  name: string;
  description: string;
  fields: SchemaField[];
}

export interface ToolGroupEntry {
  id: string;
  summary: string;
  tools: readonly string[];
  fromMcp: boolean;
  alwaysLoaded: boolean;
}

export interface EventEntry {
  event: SSEEventType;
  fields: string;
  meaning: string;
}

export interface ExtraStateEntry {
  key: string;
  meaning: string;
}

export interface ProtocolReference {
  events: EventEntry[];
  extraState: ExtraStateEntry[];
  queryRequest: SchemaField[];
  widget: SchemaField[];
  bridgeCommands: BridgeCommandEntry[];
  coreTools: string[];
  toolGroups: ToolGroupEntry[];
  typedResults: {
    kinds: string[];
    limits: { modelResultChars: number; historyChars: number; maxCitedPages: number; citedScoreShare: number };
  };
  limits: Record<string, number>;
}


const EVENT_REFERENCE: Record<SSEEventType, { fields: string; meaning: string }> = {
  copilotStatusUpdate: {
    fields: "eventType, message, group, and optionally details, artifacts, tool_call and hidden.",
    meaning: "A step of the agent's work.",
  },
  copilotMessageChunk: { fields: "delta", meaning: "Text of the answer." },
  copilotMessageArtifact: {
    fields: "An artifact.",
    meaning: "A table, an HTML document or an app that belongs to the answer.",
  },
  copilotCitationCollection: { fields: "citations", meaning: "The sources of the answer." },
  copilotPromptSuggestions: {
    fields: "suggestions, a list of strings.",
    meaning:
      "Follow-up questions. The agent sends them only when workspace_options has the key prompt-suggestions set to a true value.",
  },
  copilotFunctionCall: {
    fields: "function, input_arguments and extra_state.",
    meaning: "The agent needs the browser to do something. It is the last event of the response.",
  },
};

const EXTRA_STATE_REFERENCE: Record<(typeof EXTRA_STATE_KEYS)[number], string> = {
  copilot_function_call_arguments:
    "The widgets that the call concerns, as widget_queries with a widget_uuid each. The browser reads it to know which widgets an earlier call belonged to.",
  intermediate_citations: "The citations that the turn has collected so far.",
  document_hits: "The pages of documents that a search returned, which the agent cites when the answer names them.",
  documents_shipped: "The documents that the agent has already sent to the search tools, so that each is sent once.",
  loaded_skill_slugs: "The skills that the model has loaded.",
  loaded_tool_groups: "The groups of tools that the model has loaded.",
  pending_bridge_calls: "Calls of the agent's own bridge commands that the model asked for in one step and the agent has not yet emitted.",
  pending_workspace_calls: "Calls of the Workspace's tools that the model asked for in one step and the agent has not yet emitted.",
  traceparent: "The trace context of the turn's first request, so that all requests of a turn share one trace.",
  turn_usage: "The tokens that the turn has used, so that the usage the agent reports to the Workspace API covers the whole turn.",
  timezone: "The time zone of the turn.",
};

export function collectProtocol(): ProtocolReference {
  return {
    events: SSE_EVENT_TYPES.map((event) => ({ event, ...EVENT_REFERENCE[event] })),
    extraState: EXTRA_STATE_KEYS.map((key) => ({ key, meaning: EXTRA_STATE_REFERENCE[key] })),
    queryRequest: schemaFields(QueryRequestSchema),
    widget: schemaFields(WidgetSchema),
    bridgeCommands: WORKSPACE_BRIDGE_COMMANDS.map((command) => ({
      name: command.name,
      description: command.description,
      fields: schemaFields(command.inputSchema),
    })),
    coreTools: [...CORE_TOOLS],
    toolGroups: STATIC_GROUPS.map((group) => ({
      id: group.id,
      summary: group.summary,
      tools: group.names,
      fromMcp: group.mcp === true,
      alwaysLoaded: group.always === true,
    })),
    typedResults: {
      kinds: TYPED_ITEM_KINDS,
      limits: {
        modelResultChars: MAX_TOOL_RESULT_CHARS,
        historyChars: HISTORY_RENDER_MAX_CHARS,
        maxCitedPages: MAX_CITED_PAGES,
        citedScoreShare: CITED_SCORE_SHARE,
      },
    },
    limits: {
      searchResults: SEARCH_RESULT_CAP,
      contextTextChars: CONTEXT_TEXT_BLOCK_MAX_CHARS,
      turnSeconds: TURN_SECONDS,
      maxTokenChars: MAX_TOKEN_CHARS,
      refusedTokenSeconds: REJECTED_SECONDS,
      signInConcurrent: SIGN_IN_MAX_CONCURRENT,
      signInWaiting: SIGN_IN_MAX_WAITING,
      minScopeSecretChars: MIN_SECRET_CHARS,
      widgetDataCacheSeconds: WIDGET_DATA_TTL_SECONDS,
      rowsCacheSeconds: ROWS_TTL_SECONDS,
      maxCachedRows: MAX_CACHED_TABLE_ROWS,
      maxSqlRows: MAX_SQL_TABLE_ROWS,
      maxStatusRows: MAX_STATUS_TABLE_ROWS,
      maxInlineTextChars: MAX_INLINE_TEXT_CHARS,
      downloadMaxBytes: DEFAULT_MAX_BYTES,
      downloadTimeoutMs: URL_DOWNLOAD_TIMEOUT_MS,
      downloadMaxRedirects: MAX_REDIRECTS,
      xlsxTimeoutMs: XLSX_TIMEOUT_MS,
      maxImageBase64Chars: MAX_IMAGE_B64_CHARS,
      typeSampleRows: TYPE_SAMPLE_LIMIT,
    },
  };
}
