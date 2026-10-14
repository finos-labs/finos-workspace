/**
 * Conversation-scoped cache of parsed widget rows. Survives across HTTP
 * requests (module-level), keyed by conversationId (X-Trace-Id from the
 * workspace). Written to by `injectWidgetData` and the `sqlite_table`
 * MCP-result handler; read at the top of `runAgentLoop` to seed
 * `pendingTables` so a follow-up message in the same chat can hit
 * `execute_sql` without first round-tripping back through `get_widget_data`.
 *
 * Bounded (see lib/bounded-cache.ts): a chat's rows go after the TTL whether or not anyone asks for them
 * again, the chats that have not been used for longest go first when there are too many, and so do they
 * when all the rows held are too many. Without that a user could fill the memory of the process with
 * chats (the chat id is whatever the client sends) or with one very large table.
 * Every write sets the chat's entry again, which is what keeps an active chat alive.
 *
 * With several replicas the rows are also written to the shared store (lib/store.ts), so a follow-up
 * that reaches another replica finds them instead of fetching the widget again. The copy in this
 * process stays the first place looked, because it costs nothing to read; the shared copy is the
 * second. A table too large to be worth sending (SHARED_TABLE_MAX_BYTES) is kept here only — missing
 * it costs a re-fetch, which is what would have happened anyway.
 *
 * Writing is never waited for: rows are a cache, and a request must not be slower because one replica
 * told another about them.
 */

import { createBoundedCache, sweepEvery, type BoundedCache } from "../lib/bounded-cache";
import { getLogger } from "../lib/logger";
import type { Widget } from "../protocol/types";
import type { Store } from "../lib/store";

const logger = getLogger(["app", "agent", "row-cache"]);

// 30 min — covers typical user pauses between follow-up messages. Memory
// cost is small: ~100KB per loaded table.
const CACHE_TTL_MS = 30 * 60 * 1000;

interface ChatEntry {
  tables: Map<string, CachedRows>;
}

/** The most rows of one table that are kept for a follow-up question; a bigger table is fetched again. */
export const MAX_CACHED_TABLE_ROWS = 500_000;
const MAX_CHATS = 2_000;
const MAX_CACHED_ROWS = 5_000_000;

const rowsOf = (entry: ChatEntry): number => {
  let n = 0;
  for (const cached of entry.tables.values()) n += cached.rows.length;
  return n;
};

interface CachedRows {
  rows: Record<string, unknown>[];
  widgetUuid?: string;
  inputArgs?: Record<string, unknown>;
}

export interface RememberRowsOptions {
  widgetUuid?: string;
  inputArgs?: Record<string, unknown>;
}

// Persist across `bun --hot` reloads. Module-level state is reset whenever
// any source file changes; pinning the Map to globalThis preserves cached
// rows so dev iterations don't force the model to re-fetch widget data.
declare global {
  // eslint-disable-next-line no-var
  var __ines_chat_row_cache: BoundedCache<string, ChatEntry> | undefined;
}
const chatRowCache: BoundedCache<string, ChatEntry> =
  globalThis.__ines_chat_row_cache ??
  (globalThis.__ines_chat_row_cache = createBoundedCache<string, ChatEntry>({
    ttlMs: CACHE_TTL_MS,
    maxEntries: MAX_CHATS,
    weigh: rowsOf,
    maxWeight: MAX_CACHED_ROWS,
  }));
sweepEvery(chatRowCache, 60_000);

/**
 * The most one table may weigh, as JSON, to be worth putting in the shared store. A chat's rows can
 * be hundreds of thousands of them; sending that to Redis on every write would cost more than
 * fetching the widget again, which is what a replica without them does.
 */
export const SHARED_TABLE_MAX_BYTES = 1024 * 1024;

/** The store the rows are shared through, or null to keep them in this process only. */
let sharedStore: Store | null = null;

/** Called once at start (src/server.ts). Without it nothing is shared and nothing changes. */
export function shareRowsThrough(store: Store | null): void {
  sharedStore = store?.shared ? store : null;
}

const sharedKey = (conversationId: string, tableName: string) => `rows:${conversationId}:${tableName}`;
const sharedIndexKey = (conversationId: string) => `rows:${conversationId}`;

/** Writes a table to the shared store, if it is small enough to be worth it. Never waited for. */
function shareRows(conversationId: string, tableName: string, cached: CachedRows): void {
  const store = sharedStore;
  if (!store) return;
  void (async () => {
    try {
      const body = JSON.stringify(cached);
      if (body.length > SHARED_TABLE_MAX_BYTES) return;
      const ttl = Math.floor(CACHE_TTL_MS / 1000);
      await store.set(sharedKey(conversationId, tableName), body, ttl);
      // Which tables a chat has, so that another replica knows what to ask for.
      const index = await store.getRecord(sharedIndexKey(conversationId));
      await store.putRecord(sharedIndexKey(conversationId), { ...index, [tableName]: "1" }, ttl);
    } catch (error) {
      logger.debug("Could not share cached rows", {
        conversationId,
        tableName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}

/** Takes a table out of the shared store. Never waited for. */
function unshareRows(conversationId: string, tableName: string): void {
  const store = sharedStore;
  if (!store) return;
  void (async () => {
    try {
      await store.del(sharedKey(conversationId, tableName));
      const index = await store.getRecord(sharedIndexKey(conversationId));
      if (!index) return;
      delete index[tableName];
      const ttl = Math.floor(CACHE_TTL_MS / 1000);
      if (Object.keys(index).length === 0) await store.del(sharedIndexKey(conversationId));
      else await store.putRecord(sharedIndexKey(conversationId), index, ttl);
    } catch {
      // A table left in the shared store runs out by itself, and is checked against the widget anyway.
    }
  })();
}

/** What another replica wrote for this chat, as this process would have held it. */
async function sharedTables(conversationId: string): Promise<Map<string, CachedRows>> {
  const store = sharedStore;
  const found = new Map<string, CachedRows>();
  if (!store) return found;
  try {
    const index = await store.getRecord(sharedIndexKey(conversationId));
    if (!index) return found;
    for (const tableName of Object.keys(index)) {
      const body = await store.get(sharedKey(conversationId, tableName));
      if (!body) continue;
      const cached = normalizeCachedRows(JSON.parse(body));
      if (cached) found.set(tableName, cached);
    }
  } catch (error) {
    logger.debug("Could not read shared cached rows", {
      conversationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return found;
}

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
 * Snapshot of cached rows for a conversation. Returns an empty Map when
 * no cache exists, the entry has expired (in which case it's also dropped),
 * or no conversationId was supplied. The returned Map is a shallow copy —
 * mutating it does not affect the cache; row arrays themselves are shared
 * by reference (callers treat them as immutable).
 */
export async function getCachedRows(
  conversationId: string,
  allWidgets?: Widget[],
): Promise<Map<string, Record<string, unknown>[]>> {
  if (!conversationId) return new Map();
  const entry = chatRowCache.get(conversationId);
  // What this process holds, and what another replica wrote that it does not. The local copy wins:
  // it is at least as new, because every local write shares what it wrote.
  const tables = await sharedTables(conversationId);
  for (const [tableName, cached] of entry?.tables ?? []) tables.set(tableName, cached as CachedRows);
  if (tables.size === 0) return new Map();
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const [tableName, value] of tables) {
    const cached = normalizeCachedRows(value);
    if (!cached) {
      entry?.tables.delete(tableName);
      continue;
    }
    if (!cachedRowsMatchCurrentWidget(tableName, cached, allWidgets)) {
      logger.debug("Skipped cached widget rows with stale params", {
        conversationId,
        tableName,
        widgetUuid: cached.widgetUuid,
        cachedInputArgs: compactInputArgs(cached.inputArgs),
      });
      continue;
    }
    rows.set(tableName, cached.rows);
  }
  return rows;
}

/**
 * Persist (tableName → rows) into the conversation's cache. Refreshes the
 * entry timestamp so chats that keep producing tables stay cached past the
 * TTL window. No-ops on missing conversationId or empty rows.
 */
export function rememberRows(
  conversationId: string,
  tableName: string,
  rows: Record<string, unknown>[],
  options: RememberRowsOptions = {},
): void {
  if (!conversationId || rows.length === 0) return;
  if (rows.length > MAX_CACHED_TABLE_ROWS) {
    logger.warn("Not caching a table of {rows} rows (the most kept is {max})", { rows: rows.length, max: MAX_CACHED_TABLE_ROWS, conversationId });
    return;
  }
  const entry = chatRowCache.get(conversationId) ?? { tables: new Map<string, CachedRows>() };
  const cached: CachedRows = {
    rows,
    widgetUuid: options.widgetUuid,
    inputArgs: options.inputArgs ? compactInputArgs(options.inputArgs) : undefined,
  };
  entry.tables.set(tableName, cached);
  shareRows(conversationId, tableName, cached);
  // Set again: the entry is as new as this write, and weighs what it now holds.
  chatRowCache.set(conversationId, entry);
  logger.debug("Cached rows for chat", {
    conversationId,
    tableName,
    rowCount: rows.length,
    totalTablesCached: entry.tables.size,
  });
}

/**
 * Remove a table from the conversation cache when a fresh widget fetch proves
 * the old rows are stale, for example a filtered widget request returning no
 * rows. No-ops on missing cache state.
 */
export function forgetRows(
  conversationId: string,
  tableName: string,
): void {
  if (!conversationId) return;
  unshareRows(conversationId, tableName);
  const entry = chatRowCache.get(conversationId);
  if (!entry) return;
  if (!entry.tables.delete(tableName)) return;
  if (entry.tables.size === 0) chatRowCache.delete(conversationId);
  else chatRowCache.set(conversationId, entry);
  logger.debug("Forgot cached rows for chat", {
    conversationId,
    tableName,
    totalTablesCached: entry.tables.size,
  });
}
