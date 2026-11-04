import type { SSEEvent } from "../../../protocol/types.ts";
import { IsolationError, runInChild } from "../../../lib/isolate.ts";
import { getLogger } from "../../../lib/logger.ts";
import type { SqlChildInput, SqlChildOutput, SqlOp } from "./child.ts";

const logger = getLogger(["app", "tools", "sql", "isolated"]);

const CHILD = new URL("./child.ts", import.meta.url).pathname;

function sqlTimeoutMs(): number {
  const configured = Number(process.env.AGENT_SQL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 100 ? configured : 10_000;
}

interface IsolatedSqlContext {
  pendingTables: Map<string, Record<string, unknown>[]>;
  artifactQueue: SSEEvent[];
}

export async function runSqlIsolated(op: SqlOp, args: unknown, ctx: IsolatedSqlContext): Promise<string> {
  const input: SqlChildInput = { op, args, tables: [...ctx.pendingTables] };
  try {
    const out = await runInChild<SqlChildInput, SqlChildOutput>(CHILD, input, { timeoutMs: sqlTimeoutMs(), label: `sql ${op}`, logger });
    ctx.artifactQueue.push(...out.events);
    return out.text;
  } catch (error) {
    if (error instanceof IsolationError) {
      switch (error.kind) {
        case "timeout":
          return `SQL error: the query ran for more than ${Math.round(sqlTimeoutMs() / 1000)} seconds and was stopped. Make it cheaper: filter before you join, avoid joining a table with itself, limit what you ask for.`;
        case "busy":
          return "SQL error: the server is busy running other queries. Try again in a moment.";
        case "output":
          return "SQL error: the answer was too large. Ask for fewer rows or columns.";
        default:
          return "SQL error: the query could not be run.";
      }
    }
    throw error;
  }
}
