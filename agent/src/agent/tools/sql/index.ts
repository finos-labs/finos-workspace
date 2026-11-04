import type { ToolSet } from "ai";
import type { SSEEvent } from "../../../protocol/types.ts";
import { makeExecuteSqlTool } from "./execute-sql.ts";
import { makePeekTableTool } from "./peek-table.ts";
import { makePeekColumnValuesTool } from "./peek-column-values.ts";
import { makeCreateArtifactTool } from "./create-artifact.ts";

interface SqlToolsContext {
  pendingTables: Map<string, Record<string, unknown>[]>;
  artifactQueue: SSEEvent[];
}

const SQL_TOOL_NAMES = [
  "execute_sql",
  "peek_table",
  "peek_column_values",
  "create_artifact",
] as const;

export const SQL_TOOL_NAME_SET: ReadonlySet<string> = new Set(SQL_TOOL_NAMES);

export function makeSqlTools(ctx: SqlToolsContext): ToolSet {
  return {
    execute_sql: makeExecuteSqlTool(ctx),
    peek_table: makePeekTableTool(ctx),
    peek_column_values: makePeekColumnValuesTool(ctx),
    create_artifact: makeCreateArtifactTool(ctx),
  };
}
