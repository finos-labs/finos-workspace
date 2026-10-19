/**
 * create_artifact — render rows as a table in the workspace conversation. The
 * Workspace has no table artifact, so the table is an HTML artifact.
 * Stateless. Accepts either a SQL query against the loaded
 * `pendingTables`, or raw rows.
 *
 * Local execute: pushes the rendered artifact directly onto the agent's
 * `artifactQueue` SSE side-channel. The loop drains that queue after
 * `generateText` returns, preserving artifact ordering relative to text.
 */

import { tool } from "ai";
import { z } from "zod";
import { buildDb, tableNotFoundMessage } from "./db";
import { availableTablesHint } from "./error-hints";
import { rejectUnsafeSql, rejectUnsafeTableName } from "./safety";
import { messageArtifact } from "../../../protocol/events";
import { htmlTableArtifact } from "../../../protocol/html-table";
import type { SSEEvent } from "../../../protocol/types";
import { getLogger } from "../../../lib/logger";
import { displaySummarySchema } from "../progress";
import { runSqlIsolated } from "./isolated";

const logger = getLogger(["app", "tools", "sql", "create_artifact"]);

const MAX_ARTIFACT_ROWS = 500;

const tableSpec = z.object({
  type: z.literal("table").describe("Use literal 'table' for table artifacts."),
  name: z.string().describe("Display name for the table."),
  description: z.string().describe("What this table shows."),
});

const artifactSpec = tableSpec;

const parseIfString = (val: unknown): unknown => {
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
};

const absentIfNull = (val: unknown): unknown => val == null ? undefined : val;

export const createArtifactSchema = z.object({
  display_summary: displaySummarySchema,
  sql: z
    .preprocess(absentIfNull, z.string().optional())
    .describe(
      "SQL query to source rows from loaded tables. Alternative to data/from_table_id; if using sql, omit data and from_table_id.",
    ),
  data: z
    .preprocess(parseIfString, z.array(z.record(z.string(), z.unknown())).nullable())
    .optional()
    .describe("Raw row array. Alternative to sql/from_table_id; if using data, omit sql and from_table_id."),
  from_table_id: z
    .preprocess(absentIfNull, z.string().optional())
    .describe(
      "Name of an already-loaded table in pendingTables (e.g. 'aapl_prices'). " +
        "Alternative to sql/data. Use only when rendering the loaded table as-is; if filtering/aliasing, use sql instead. " +
        "This must be a loaded table name, not an execute_sql result set or CTE alias.",
    ),
  artifact: z
    .preprocess(parseIfString, artifactSpec)
    .describe("Table spec — one table per call."),
});

export const createArtifactDescription =
  "Render a table in the workspace conversation (as an HTML artifact). " +
  "Provide exactly one of: `sql` (queries shipped tables), `data` (raw rows), or `from_table_id` (rows from a loaded table); omit unused source fields instead of sending null. " +
  "If you use `sql`, omit `from_table_id` and `data`. If you use `from_table_id`, omit `sql` and `data`. If you use `data`, omit `sql` and `from_table_id`. " +
  "execute_sql result sets and CTE aliases are not persistent tables; to render a previous CTE, include the full WITH query in `sql`. " +
  "For CSV/export/download/full-table requests, render a table from SQL/data instead of pasting raw rows into the final response. " +
  "This tool draws tables only. For a chart, write the HTML or SVG yourself with create_html_artifact and follow the `html-chart` skill. " +
  "Use only column names that exist in the selected rows. " +
  "For UNION/INTERSECT/EXCEPT queries, put custom sort expressions in an outer SELECT or output sort_key alias; SQLite does not allow ORDER BY CASE directly on a compound SELECT. " +
  "Do not switch to `data` unless you are passing raw row objects. " +
  "After a successful create_artifact call, do not call create_artifact again for the same table; continue to the final answer. " +
  "Call peek_table before this tool when loaded table or column names are uncertain.";

interface ArtifactSpec {
  type: "table";
  name: string;
  description: string;
}

export interface CreateArtifactContext {
  pendingTables: Map<string, Record<string, unknown>[]>;
  artifactQueue: SSEEvent[];
}

export interface CreateArtifactArgs {
  sql?: string;
  data?: Record<string, unknown>[] | null;
  from_table_id?: string;
  artifact: ArtifactSpec;
}

export function runCreateArtifact(
  args: CreateArtifactArgs,
  ctx: CreateArtifactContext,
): string {
  const startedAt = Date.now();
  const sql = args.sql?.trim() ? args.sql : undefined;
  const rawFromTableId = args.from_table_id?.trim() ? args.from_table_id : undefined;
  const data = Array.isArray(args.data) ? args.data : undefined;
  const hasDataSource = data !== undefined && (data.length > 0 || (!sql && !rawFromTableId));
  const fromTableId = rawFromTableId;
  const via = fromTableId ? "from_table_id" : sql ? "sql" : "data";
  const sqlPreview = sql ? sql.replace(/\s+/g, " ").slice(0, 300) : null;
  logger.info(
    `create_artifact entry kind=${args.artifact.type} via=${via} name=${JSON.stringify(args.artifact.name)}${sqlPreview ? ` sql="${sqlPreview}"` : ""}`,
    { hasSql: !!sql, hasData: hasDataSource, fromTableId },
  );

  const sourceCount =
    (sql ? 1 : 0) + (hasDataSource ? 1 : 0) + (rawFromTableId ? 1 : 0);
  if (sourceCount === 0) {
    return "Error: provide one of `sql`, `data`, or `from_table_id`.";
  }
  if (sourceCount > 1) {
    return "Error: pass exactly one of `sql`, `data`, or `from_table_id` — not multiple.";
  }

  let rows: Record<string, unknown>[];
  if (fromTableId) {
    const denyMsg = rejectUnsafeTableName(fromTableId);
    if (denyMsg) return denyMsg;
    const { db, loaded } = buildDb(ctx.pendingTables);
    try {
      const tInfo = loaded.find((t) => t.tableName === fromTableId);
      if (!tInfo) {
        // Keep this tool's `Error:` prefix — `artifactFailed` in tool-status
        // classifies create_artifact failures by it.
        return `Error: ${tableNotFoundMessage(fromTableId, loaded)}`;
      }
      rows = db.query(`SELECT * FROM "${fromTableId}"`).all() as Record<
        string,
        unknown
      >[];
    } finally {
      db.close();
    }
  } else if (sql) {
    const denyMsg = rejectUnsafeSql(sql);
    if (denyMsg) return denyMsg;
    const { db, loaded } = buildDb(ctx.pendingTables);
    try {
      rows = db.query(sql).all() as Record<string, unknown>[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      db.close();
      return `SQL error: ${msg}.${availableTablesHint(loaded)}`;
    }
    db.close();
  } else {
    rows = data!;
  }

  if (rows.length === 0) {
    return "No rows — query returned empty or `data` was empty.";
  }
  if (rows.length > MAX_ARTIFACT_ROWS) {
    rows = rows.slice(0, MAX_ARTIFACT_ROWS);
  }

  const artifact = htmlTableArtifact(args.artifact.name, args.artifact.description, rows);
  ctx.artifactQueue.push(messageArtifact(artifact));
  const firstRowKeys = Object.keys(rows[0] ?? {});
  const firstRowPreview = (JSON.stringify(rows[0] ?? {}) ?? "undefined").slice(0, 400);
  const totalMs = Date.now() - startedAt;
  logger.info(
    "create_artifact exit kind={kind} rows={rows} ms={totalMs} cols=[{firstRowKeys}] firstRow={firstRowPreview}",
    {
      kind: args.artifact.type,
      rows: rows.length,
      totalMs,
      firstRowKeys: firstRowKeys.join(", "),
      firstRowPreview,
    },
  );
  return (
    `Created ${args.artifact.type} artifact "${args.artifact.name}" from ${rows.length} rows. ` +
    "The artifact is now rendered in the workspace. Don't repeat the raw data in your text response."
  );
}

export function makeCreateArtifactTool(ctx: CreateArtifactContext) {
  return tool({
    description: createArtifactDescription,
    inputSchema: createArtifactSchema,
    execute: async (args) => {
      const a = args as CreateArtifactArgs;
      // Rows given as they are need no database: nothing here can run long.
      if (!a.sql?.trim() && !a.from_table_id?.trim()) return runCreateArtifact(a, ctx);
      const refused = a.sql?.trim() ? rejectUnsafeSql(a.sql) : null;
      return refused ?? runSqlIsolated("create_artifact", a, ctx);
    },
  });
}
