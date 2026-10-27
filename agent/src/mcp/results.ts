import type { ModelMessage } from "ai";
import type { CopilotArtifact, SSEEvent, ToolMessage } from "../protocol/types.ts";
import { messageArtifact } from "../protocol/events.ts";
import { analyzeTable, type TableInfo } from "../sql/loader.ts";
import { rememberRows } from "../agent/row-cache.ts";
import { getLogger } from "../lib/logger.ts";
import { clipForModel, MAX_TOOL_RESULT_CHARS } from "../agent/clip.ts";

const logger = getLogger(["app", "mcp", "results"]);

interface WebCitation {
  id: string;
  type: "web";
  url: string;
  title: string;
}

export interface DocumentCitation {
  id: string;
  type: "document";
  uri: string;
  title: string;
  page?: number;
  score?: number;
}

export type McpCitation = WebCitation | DocumentCitation;

type InesTypedItem =
  | { $ines_kind: "artifact"; artifact: CopilotArtifact }
  | { $ines_kind: "citation"; citation: WebCitationData | DocumentCitationData }
  | { $ines_kind: "sqlite_table"; name: string; rows: Record<string, unknown>[] }
  | { $ines_kind: "error"; error: { code: string; message: string; retryable?: boolean } }
  | { $ines_kind: "model_context"; summary: string };

const KIND_NAMES: Record<InesTypedItem["$ines_kind"], true> = {
  artifact: true,
  citation: true,
  sqlite_table: true,
  error: true,
  model_context: true,
};
export const TYPED_ITEM_KINDS = Object.keys(KIND_NAMES) as InesTypedItem["$ines_kind"][];

interface WebCitationData {
  type: "web";
  url: string;
  title: string;
  id?: string;
}

interface DocumentCitationData {
  type: "document";
  uri: string;
  title: string;
  page?: number;
  score?: number;
  id?: string;
}

function readItemText(rawItem: unknown): string | null {
  if (!rawItem || typeof rawItem !== "object") return null;
  const item = rawItem as { content?: unknown; text?: unknown };
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  return null;
}

function tryParseJson(text: string): unknown {
  if (text.length === 0 || (text[0] !== "{" && text[0] !== "[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asTypedItem(value: unknown): InesTypedItem | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { $ines_kind?: unknown }).$ines_kind === "string"
  ) {
    return value as InesTypedItem;
  }
  return null;
}

export interface McpResultContext {
  tables: TableInfo[];
  artifactQueue: SSEEvent[];
  citations: McpCitation[];
  messages: ModelMessage[];
  pendingTables: Map<string, Record<string, unknown>[]>;
  conversationId: string;
}

export interface McpResultSummary {
  toolName: string;
  serverId: string;
  textChars: number;
  outputPreview: string;
  outputRows?: Record<string, unknown>[];
  artifactCount: number;
  citationCount: number;
  tableCount: number;
  errorCount: number;
  hasModelContext: boolean;
}

interface Counters {
  textParts: string[];
  modelContext: string | null;
  artifactCount: number;
  citationCount: number;
  tableCount: number;
  errorCount: number;
}

const MAX_OUTPUT_ARTIFACT_ROWS = 100;
const MAX_OUTPUT_ARTIFACT_STRING = 2_000;
const OUTPUT_ARRAY_KEYS = ["results", "data", "items", "rows"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compactOutputValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length <= MAX_OUTPUT_ARTIFACT_STRING
      ? value
      : `${value.slice(0, MAX_OUTPUT_ARTIFACT_STRING)}... [truncated, ${value.length} chars total]`;
  }
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (depth > 1) return "[object]";
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, compactOutputValue(nested, depth + 1)]),
  );
}

function rowFromValue(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, compactOutputValue(nested)]),
    );
  }
  return { value: compactOutputValue(value) };
}

function scalarMetadata(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value === null || typeof value !== "object")
      .map(([key, value]) => [key, compactOutputValue(value)]),
  );
}

function rowsFromArray(
  values: unknown[],
  metadata: Record<string, unknown> = {},
): Record<string, unknown>[] | undefined {
  const rows = values.slice(0, MAX_OUTPUT_ARTIFACT_ROWS).map((value) => ({
    ...metadata,
    ...rowFromValue(value),
  }));
  return rows.length > 0 ? rows : undefined;
}

function outputRowsFromJson(value: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(value)) return rowsFromArray(value);
  if (isRecord(value)) {
    const metadata = scalarMetadata(value);
    for (const key of OUTPUT_ARRAY_KEYS) {
      const nested = value[key];
      if (Array.isArray(nested)) return rowsFromArray(nested, metadata);
    }
    return [rowFromValue(value)];
  }
  return [{ value: compactOutputValue(value) }];
}

function isEmptyArtifactContent(artifact: CopilotArtifact): boolean {
  const content = "content" in artifact ? artifact.content : undefined;
  return (
    content === "" ||
    content === undefined ||
    content === null ||
    (Array.isArray(content) && content.length === 0)
  );
}

function artifactAckText(artifact: CopilotArtifact): string {
  return `[Artifact "${artifact.name}" (${artifact.type}) delivered to the user — already rendered in the chat, do not regenerate it]`;
}

function dispatchTyped(typed: InesTypedItem, ctx: McpResultContext, c: Counters): void {
  switch (typed.$ines_kind) {
    case "artifact": {
      if (isEmptyArtifactContent(typed.artifact)) return;
      ctx.artifactQueue.push(messageArtifact(typed.artifact));
      c.artifactCount++;
      c.textParts.push(artifactAckText(typed.artifact));
      return;
    }

    case "citation": {
      const id = typed.citation.id ?? crypto.randomUUID();
      if (typed.citation.type === "web") {
        ctx.citations.push({ id, type: "web", url: typed.citation.url, title: typed.citation.title });
      } else {
        ctx.citations.push({
          id,
          type: "document",
          uri: typed.citation.uri,
          title: typed.citation.title,
          ...(typed.citation.page != null ? { page: typed.citation.page } : {}),
          ...(typeof typed.citation.score === "number" ? { score: typed.citation.score } : {}),
        });
      }
      c.citationCount++;
      return;
    }

    case "sqlite_table": {
      if (typed.rows.length > 0) {
        const table = analyzeTable(typed.name, typed.rows);
        ctx.tables.push(table);
        ctx.pendingTables.set(table.tableName, typed.rows);
        rememberRows(ctx.conversationId, table.tableName, typed.rows);
        c.tableCount++;
        const colLines = table.columns
          .map((col) => `  - "${col.name}" (${col.type})`)
          .join("\n");
        c.textParts.push(
          `[${table.rowCount} rows available as table "${table.tableName}"]\n` +
          `Columns:\n${colLines}\n` +
          `Query via execute_sql.`,
        );
      }
      return;
    }

    case "error": {
      const retryable = typed.error.retryable ?? false;
      c.errorCount++;
      c.textParts.push(
        `[ERROR ${typed.error.code}${retryable ? " retryable" : ""}] ${typed.error.message}`,
      );
      return;
    }

    case "model_context": {
      c.modelContext = typed.summary;
      return;
    }
  }
}

function processPayload(text: string, ctx: McpResultContext, c: Counters): void {
  const parsed = tryParseJson(text);

  if (Array.isArray(parsed)) {
    for (const sub of parsed) {
      if (typeof sub === "string") {
        processPayload(sub, ctx, c);
      } else {
        const typed = asTypedItem(sub);
        if (typed) dispatchTyped(typed, ctx, c);
        else c.textParts.push(JSON.stringify(sub));
      }
    }
    return;
  }

  const typed = asTypedItem(parsed);
  if (typed) {
    dispatchTyped(typed, ctx, c);
    return;
  }

  c.textParts.push(text);
}

export function processMcpResult(
  toolMsg: ToolMessage,
  ctx: McpResultContext,
): McpResultSummary {
  const toolName = (toolMsg.input_arguments?.tool_name as string) ?? "unknown";
  const serverId = (toolMsg.input_arguments?.server_id as string) ?? "unknown";

  const counters: Counters = {
    textParts: [],
    modelContext: null,
    artifactCount: 0,
    citationCount: 0,
    tableCount: 0,
    errorCount: 0,
  };

  for (const entry of toolMsg.data ?? []) {
    for (const rawItem of entry.items ?? []) {
      const text = readItemText(rawItem);
      if (text === null || text === "") continue;
      processPayload(text, ctx, counters);
    }
  }

  const { textParts, modelContext, artifactCount, citationCount, tableCount, errorCount } = counters;

  const llmContent = modelContext ?? (textParts.length > 0 ? textParts.join("\n\n") : null);
  const parsedOutput = llmContent === null ? null : tryParseJson(llmContent);
  const outputRows = parsedOutput === null ? undefined : outputRowsFromJson(parsedOutput);
  if (llmContent !== null) {
    ctx.messages.push({
      role: "user" as const,
      content: `MCP tool result from ${toolName}:\n\n${clipForModel(llmContent, MAX_TOOL_RESULT_CHARS, "ask for less, or for a part of it")}`,
    });
  }

  const summary: McpResultSummary = {
    toolName,
    serverId,
    textChars: (llmContent ?? "").length,
    outputPreview: (llmContent ?? "").slice(0, HISTORY_RENDER_MAX_CHARS),
    ...(outputRows ? { outputRows } : {}),
    artifactCount,
    citationCount,
    tableCount,
    errorCount,
    hasModelContext: modelContext !== null,
  };

  const { outputRows: _outputRows, ...logSummary } = summary;
  logger.info("MCP result processed", {
    ...logSummary,
    outputRowCount: outputRows?.length ?? 0,
  });
  return summary;
}

export const HISTORY_RENDER_MAX_CHARS = 2_000;

export function renderToolResultForHistory(toolMsg: ToolMessage): string | null {
  const parts: string[] = [];
  let modelContext: string | null = null;

  function visitTyped(typed: InesTypedItem): void {
    switch (typed.$ines_kind) {
      case "artifact":
        if (!isEmptyArtifactContent(typed.artifact)) parts.push(artifactAckText(typed.artifact));
        return;
      case "sqlite_table":
        if (typed.rows.length > 0) parts.push(`[${typed.rows.length} rows loaded as table "${typed.name}"]`);
        return;
      case "error":
        parts.push(`[ERROR ${typed.error.code}] ${typed.error.message}`);
        return;
      case "model_context":
        modelContext = typed.summary;
        return;
      case "citation":
        return;
    }
  }

  function visit(text: string): void {
    const parsed = tryParseJson(text);
    if (Array.isArray(parsed)) {
      for (const sub of parsed) {
        if (typeof sub === "string") {
          visit(sub);
        } else {
          const typed = asTypedItem(sub);
          if (typed) visitTyped(typed);
          else parts.push(JSON.stringify(sub));
        }
      }
      return;
    }
    const typed = asTypedItem(parsed);
    if (typed) visitTyped(typed);
    else parts.push(text);
  }

  for (const entry of toolMsg.data ?? []) {
    for (const rawItem of entry.items ?? []) {
      const text = readItemText(rawItem);
      if (text === null || text === "") continue;
      visit(text);
    }
  }

  const content = modelContext ?? (parts.length > 0 ? parts.join("\n\n") : null);
  if (content === null) return null;
  return content.length > HISTORY_RENDER_MAX_CHARS
    ? `${content.slice(0, HISTORY_RENDER_MAX_CHARS)}\n… [truncated]`
    : content;
}
