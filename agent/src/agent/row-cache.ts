import { getLogger } from "../lib/logger.ts";
import type { Store } from "../lib/store.ts";
import type { Widget } from "../protocol/types.ts";
import type { WidgetItem } from "../widgets/parse.ts";

const logger = getLogger(["app", "agent", "row-cache"]);

export const ROWS_TTL_SECONDS = 30 * 60;
export const WIDGET_DATA_TTL_SECONDS = 5 * 60;

export const MAX_CACHED_TABLE_ROWS = 500_000;

interface CachedRows {
  rows: Record<string, unknown>[];
  widgetUuid?: string;
  inputArgs?: Record<string, unknown>;
  dataVersion?: unknown;
}

interface RememberRowsOptions {
  widgetUuid?: string;
  inputArgs?: Record<string, unknown>;
  dataVersion?: unknown;
}

/** Set by a widget whose rows change with no change of its parameters, such as an MCP App the user filters. */
export function widgetDataVersion(widget: Widget | undefined): unknown {
  return widget?.metadata?.data_version;
}

let store: Store | null = null;

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
    dataVersion: record.dataVersion,
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
  // Only rows a widget gave carry its version; a table the chat made itself has none.
  if (cached.widgetUuid && cached.dataVersion !== widgetDataVersion(widget)) return false;
  if (!cached.widgetUuid && stableInputArgsKey(currentWidgetInputArgs(widget)) !== "{}") {
    return false;
  }
  return stableInputArgsKey(cached.inputArgs) === stableInputArgsKey(currentWidgetInputArgs(widget));
}

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
    dataVersion: options.dataVersion,
  };
  logger.debug("Keeping rows for chat", { conversationId, tableName, rowCount: rows.length });
  return (async () => {
    await target.set(tableKey(conversationId, tableName), JSON.stringify(cached), ROWS_TTL_SECONDS);
    const tables = await target.getRecord(tablesKey(conversationId));
    await target.putRecord(tablesKey(conversationId), { ...tables, [tableName]: "1" }, ROWS_TTL_SECONDS);
  })().catch((error) => logger.debug("Could not keep a chat's rows", { conversationId, tableName, message: reason(error) }));
}

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
  });
}

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

export async function keepWidgetData(scope: string, cacheKey: string, items: WidgetItem[]): Promise<void> {
  const target = store;
  if (!scope || !target) return;
  try {
    await target.set(widgetDataKey(scope, cacheKey), JSON.stringify(items), WIDGET_DATA_TTL_SECONDS);
  } catch (error) {
    logger.debug("Could not keep widget data", { scope, message: reason(error) });
  }
}
