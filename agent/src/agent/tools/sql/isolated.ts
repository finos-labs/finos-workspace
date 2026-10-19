/**
 * The SQL tools, run where they cannot hurt the rest of the agent.
 *
 * What the model writes as SQL can take for ever (a recursive query that never stops, a join of a table
 * with itself nine times) or ask for more memory than there is, and SQLite cannot be interrupted from
 * JavaScript while it runs. So the tools run in a child process (see lib/isolate.ts) that is killed when
 * its time is up; this process stays free for everybody else. The model is told what happened and can
 * write a cheaper query.
 */

import type { SSEEvent } from "../../../protocol/types";
import { IsolationError, runInChild } from "../../../lib/isolate";
import { getLogger } from "../../../lib/logger";
import type { SqlChildInput, SqlChildOutput, SqlOp } from "./child";

const logger = getLogger(["app", "tools", "sql", "isolated"]);

const CHILD = new URL("./child.ts", import.meta.url).pathname;

/** How long one SQL tool call may run: INES_SQL_TIMEOUT_MS (default 10 s). */
export function sqlTimeoutMs(): number {
  const configured = Number(process.env.INES_SQL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 100 ? configured : 10_000;
}

export interface IsolatedSqlContext {
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
