import { serveOnce } from "../../../lib/isolate-child.ts";
import type { SSEEvent } from "../../../protocol/types.ts";
import { runCreateArtifact, type CreateArtifactArgs } from "./create-artifact.ts";
import { runExecuteSql } from "./execute-sql.ts";
import { runPeekColumnValues } from "./peek-column-values.ts";
import { runPeekTable } from "./peek-table.ts";
import { runPluginArtifact, type PluginArtifactArgs } from "../plugin-artifact.ts";
import type { PluginArtifactEntry } from "../../../protocol/types.ts";

export type SqlOp =
  | "execute_sql"
  | "peek_table"
  | "peek_column_values"
  | "create_artifact"
  | "show_plugin_artifact";

export interface SqlChildInput {
  op: SqlOp;
  args: unknown;
  tables: [string, Record<string, unknown>[]][];
}

export interface SqlChildOutput {
  text: string;
  events: SSEEvent[];
}

function runSqlOp(input: SqlChildInput): SqlChildOutput {
  const events: SSEEvent[] = [];
  const ctx = { pendingTables: new Map(input.tables), artifactQueue: events };
  switch (input.op) {
    case "execute_sql":
      return { text: runExecuteSql(input.args as { sql: string }, ctx), events };
    case "peek_table":
      return { text: runPeekTable(input.args as { table_name?: string; limit?: number }, ctx), events };
    case "peek_column_values":
      return { text: runPeekColumnValues(input.args as { column: string; table_name?: string }, ctx), events };
    case "create_artifact":
      return { text: runCreateArtifact(input.args as CreateArtifactArgs, ctx), events };
    case "show_plugin_artifact": {
      const args = input.args as PluginArtifactArgs & { catalog: PluginArtifactEntry[] };
      return { text: runPluginArtifact(args, { ...ctx, catalog: args.catalog }), events };
    }
    default:
      throw new Error(`Unknown SQL operation: ${String(input.op)}`);
  }
}

if (import.meta.main) await serveOnce(runSqlOp);
