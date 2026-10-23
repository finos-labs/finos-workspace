/**
 * A chat's data between the requests of a conversation: the rows of each table it has loaded, and the widget data
 * the browser sent back. Both are kept in Redis (the store's `sharedOnly()`, lib/store.ts) and nowhere else, never
 * in a process's memory, so every replica reads the same data. Without REDIS_URL, or while Redis cannot answer,
 * nothing is kept: a follow-up fetches the widget again.
 *
 * The rows seed `pendingTables` at the top of `runAgentLoop`, so a follow-up in the same chat can run
 * `execute_sql` without the widget being fetched again. The widget data answers a re-fetch inside a turn without
 * a round trip to the browser. Both are filed under the chat's scope key, which names the user, so one user never
 * reads another's.
 */

import { getLogger } from "../lib/logger.ts";
import type { Store } from "../lib/store.ts";
import type { Widget } from "../protocol/types.ts";
import type { WidgetItem } from "../widgets/parse.ts";

const logger = getLogger(["app", "agent", "row-cache"]);

/** How long a chat's rows are kept: long enough for the pauses between follow-up questions. */
const ROWS_TTL_SECONDS = 30 * 60;
/** How long widget data is kept: a turn and its re-fetches. */
const WIDGET_DATA_TTL_SECONDS = 5 * 60;

/** The most rows of one table that are kept for a follow-up question; a bigger table is fetched again. */
export const MAX_CACHED_TABLE_ROWS = 500_000;

interface CachedRows {
  rows: Record<string, unknown>[];
  widgetUuid?: string;
  inputArgs?: Record<string, unknown>;
}

export interface RememberRowsOptions {
  widgetUuid?: string;
  inputArgs?: Record<string, unknown>;
}

/** Where a chat's data is kept: Redis alone. Without it (no REDIS_URL, or before start) nothing is kept. */
let store: Store | null = null;

/** Called once at start (src/server.ts) with the agent's store in Redis alone, or null when there is no Redis. */
export function keepChatDataIn(next: Store | null): void {
  store = next;
}

const tableKey = (conversationId: string, tableName: string) => `rows:${conversationId}:${tableName}`;
const tablesKey = (conversationId: string) => `rows:${conversationId}`;
const widgetDataKey = (scope: string, cacheKey: string) => `widget-data:${scope}:${cacheKey}`;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

function compactInputArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value != null && value !== ""),
  );
}

function stableInputArgsKey(args: Record<string, unknown> | undefined): string {
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

function currentWidgetInputArgs(widget: Widget): Record<string, unknown> {
  return Object.fromEntries(
    widget.params.map((param) => [param.name, param.current_value ?? param.default_value]),
  );
}

function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "col_$1")
    .toLowerCase();
}

function normalizeCachedRows(value: unknown): CachedRows | null {
  if (Array.isArray(value)) {
    return value.every((row) => row && typeof row === "object" && !Array.isArray(row))
      ? { rows: value as Record<string, unknown>[] }
      : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<CachedRows>;
  if (!Array.isArray(record.rows)) return null;
  return {
    rows: record.rows,
    widgetUuid: typeof record.widgetUuid === "string" ? record.widgetUuid : undefined,
    inputArgs:
      record.inputArgs && typeof record.inputArgs === "object" && !Array.isArray(record.inputArgs)
        ? record.inputArgs
        : undefined,
  };
}

function cachedRowsMatchCurrentWidget(
  tableName: string,
  cached: CachedRows,
  allWidgets?: Widget[],
): boolean {
  if (!allWidgets) return true;
  const widget = cached.widgetUuid
    ? allWidgets.find((w) => w.uuid === cached.widgetUuid)
    : allWidgets.find((w) => sanitizeName(w.name) === tableName);
  if (!widget) return true;
  if (!cached.widgetUuid && stableInputArgsKey(currentWidgetInputArgs(widget)) !== "{}") {
    return false;
  }
  return stableInputArgsKey(cached.inputArgs) === stableInputArgsKey(currentWidgetInputArgs(widget));
}

/**
 * The rows of a conversation's tables, from the store, that still match the widget they came from. An empty
 * Map when there is no store, no conversationId, or nothing kept for the chat.
 */
export async function getCachedRows(
  conversationId: string,
  allWidgets?: Widget[],
): Promise<Map<string, Record<string, unknown>[]>> {
  const rows = new Map<string, Record<string, unknown>[]>();
  const target = store;
  if (!conversationId || !target) return rows;
  try {
    const tables = await target.getRecord(tablesKey(conversationId));
    for (const tableName of Object.keys(tables ?? {})) {
      const body = await target.get(tableKey(conversationId, tableName));
      if (!body) continue;
      const cached = normalizeCachedRows(JSON.parse(body));
      if (!cached) continue;
      if (!cachedRowsMatchCurrentWidget(tableName, cached, allWidgets)) {
        logger.debug("Skipped kept widget rows with stale params", {
          conversationId,
          tableName,
          widgetUuid: cached.widgetUuid,
          cachedInputArgs: compactInputArgs(cached.inputArgs),
        });
        continue;
      }
      rows.set(tableName, cached.rows);
    }
  } catch (error) {
    logger.debug("Could not read a chat's rows", { conversationId, message: reason(error) });
  }
  return rows;
}

/**
 * Keeps (tableName → rows) for the conversation, in the store. The agent does not wait for it: the rows are a
 * cache, the request that wrote them has them already, and the next request of the chat comes after a model call.
 * The returned write never fails. No-op on a missing conversationId, empty rows, or no store.
 */
export function rememberRows(
  conversationId: string,
  tableName: string,
  rows: Record<string, unknown>[],
  options: RememberRowsOptions = {},
): Promise<void> {
  const target = store;
  if (!conversationId || rows.length === 0 || !target) return Promise.resolve();
  if (rows.length > MAX_CACHED_TABLE_ROWS) {
    logger.warn("Not keeping a table of {rows} rows (the most kept is {max})", { rows: rows.length, max: MAX_CACHED_TABLE_ROWS, conversationId });
    return Promise.resolve();
  }
  const cached: CachedRows = {
    rows,
    widgetUuid: options.widgetUuid,
    inputArgs: options.inputArgs ? compactInputArgs(options.inputArgs) : undefined,
  };
  logger.debug("Keeping rows for chat", { conversationId, tableName, rowCount: rows.length });
  return (async () => {
    await target.set(tableKey(conversationId, tableName), JSON.stringify(cached), ROWS_TTL_SECONDS);
    // Which tables a chat has, so that a request knows what to read.
    const tables = await target.getRecord(tablesKey(conversationId));
    await target.putRecord(tablesKey(conversationId), { ...tables, [tableName]: "1" }, ROWS_TTL_SECONDS);
  })().catch((error) => logger.debug("Could not keep a chat's rows", { conversationId, tableName, message: reason(error) }));
}

/**
 * Removes a table from the conversation's kept rows when a fresh widget fetch proves the old rows are stale, for
 * example a filtered widget request returning no rows. The agent does not wait for it; the returned removal never
 * fails. No-op without a store.
 */
export function forgetRows(conversationId: string, tableName: string): Promise<void> {
  const target = store;
  if (!conversationId || !target) return Promise.resolve();
  logger.debug("Forgetting rows for chat", { conversationId, tableName });
  return (async () => {
    await target.del(tableKey(conversationId, tableName));
    const tables = await target.getRecord(tablesKey(conversationId));
    if (!tables) return;
    delete tables[tableName];
    if (Object.keys(tables).length === 0) await target.del(tablesKey(conversationId));
    else await target.putRecord(tablesKey(conversationId), tables, ROWS_TTL_SECONDS);
  })().catch(() => {
    // Rows left in the store run out by themselves, and are checked against the widget anyway.
  });
}

/** The widget data the browser sent back for this widget and these parameters (`cacheKey`) in the chat, or null. */
export async function getKeptWidgetData(scope: string, cacheKey: string): Promise<WidgetItem[] | null> {
  const target = store;
  if (!scope || !target) return null;
  try {
    const body = await target.get(widgetDataKey(scope, cacheKey));
    return body ? (JSON.parse(body) as WidgetItem[]) : null;
  } catch (error) {
    logger.debug("Could not read kept widget data", { scope, message: reason(error) });
    return null;
  }
}

/** Keeps the widget data the browser sent back, in the store. Waited for: the same request may read it back. */
export async function keepWidgetData(scope: string, cacheKey: string, items: WidgetItem[]): Promise<void> {
  const target = store;
  if (!scope || !target) return;
  try {
    await target.set(widgetDataKey(scope, cacheKey), JSON.stringify(items), WIDGET_DATA_TTL_SECONDS);
  } catch (error) {
    logger.debug("Could not keep widget data", { scope, message: reason(error) });
  }
}
