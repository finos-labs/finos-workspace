import { tool } from "ai";
import { z } from "zod";
import { jsonSchemaToZod } from "../../mcp/schema.ts";
import { messageArtifact } from "../../protocol/events.ts";
import type { PluginArtifact, PluginArtifactEntry, SSEEvent } from "../../protocol/types.ts";
import { getLogger } from "../../lib/logger.ts";
import { displaySummarySchema } from "./progress.ts";
import { readSourceRows } from "./sql/create-artifact.ts";
import { runSqlIsolated } from "./sql/isolated.ts";

const logger = getLogger(["app", "tools", "show_plugin_artifact"]);

const MAX_DATA_BYTES = 256 * 1024;
const MAX_SCHEMA_HINT_CHARS = 4_000;

export const entryId = (entry: Pick<PluginArtifactEntry, "plugin" | "widget">): string =>
  `${entry.plugin}/${entry.widget}`;

export function pluginArtifactSchema(catalog: readonly PluginArtifactEntry[]) {
  const ids = catalog.map(entryId) as [string, ...string[]];
  return z.object({
    display_summary: displaySummarySchema,
    component: z
      .enum(ids)
      .describe(
        "The component to show. " +
          catalog
            .map(
              (entry) =>
                `${entryId(entry)}: ${entry.name}. ${entry.description} Its data: ${JSON.stringify(entry.data_schema)}` +
                (entry.config_schema ? ` Its config: ${JSON.stringify(entry.config_schema)}` : ""),
            )
            .join(" | "),
      ),
    name: z.string().min(1).max(200).describe("Short name shown on the card and used for the dashboard widget."),
    description: z.string().max(500).optional().describe("One line on what the component shows."),
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("The component's data, an object that follows its data schema."),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Settings, only when the component lists a config schema."),
    sql: z
      .string()
      .optional()
      .describe(
        "SQLite SELECT over the loaded tables whose rows fill data[rows_key]. Use it for rows you have loaded, so they do not pass through your answer.",
      ),
    from_table_id: z
      .string()
      .optional()
      .describe("A loaded table, as it is, whose rows fill data[rows_key]. Alternative to sql."),
    rows_key: z
      .string()
      .optional()
      .describe("The property of data that receives the rows of sql or from_table_id. Required with them."),
  });
}

export const pluginArtifactDescription =
  "Show a plugin's component (a chart or another view) in the chat, filled with data you have: " +
  "pass `data` as the component's schema says, or rows from the loaded tables with `sql`/`from_table_id` and `rows_key`. " +
  "The user can add the card to a dashboard as a widget. Do not repeat the data in your answer.";

export interface PluginArtifactArgs {
  component: string;
  name: string;
  description?: string;
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
  sql?: string;
  from_table_id?: string;
  rows_key?: string;
}

export interface PluginArtifactContext {
  catalog: readonly PluginArtifactEntry[];
  pendingTables: Map<string, Record<string, unknown>[]>;
  artifactQueue: SSEEvent[];
}

function problems(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function runPluginArtifact(args: PluginArtifactArgs, ctx: PluginArtifactContext): string {
  const entry = ctx.catalog.find((e) => entryId(e) === args.component);
  if (!entry) {
    return `Error: unknown component "${args.component}". Available: ${ctx.catalog.map(entryId).join(", ")}.`;
  }

  const fromTable = args.from_table_id?.trim() || undefined;
  const sql = args.sql?.trim() || undefined;
  if (fromTable && sql) return "Error: pass `sql` or `from_table_id`, not both.";
  const data: Record<string, unknown> = { ...(args.data ?? {}) };
  if (fromTable || sql) {
    if (!args.rows_key) return "Error: `rows_key` says which property of data receives the rows.";
    const read = readSourceRows({ sql, fromTableId: fromTable }, ctx.pendingTables);
    if ("error" in read) return read.error;
    data[args.rows_key] = read.rows;
  } else if (args.rows_key) {
    return "Error: `rows_key` goes with `sql` or `from_table_id`.";
  }

  const checked = jsonSchemaToZod(entry.data_schema).safeParse(data);
  if (!checked.success) {
    return (
      `Error: data does not match the schema of ${args.component}: ${problems(checked.error)}. ` +
      `Schema: ${JSON.stringify(entry.data_schema).slice(0, MAX_SCHEMA_HINT_CHARS)}`
    );
  }
  const accepted = checked.data as Record<string, unknown>;
  const bytes = Buffer.byteLength(JSON.stringify(accepted), "utf-8");
  if (bytes > MAX_DATA_BYTES) {
    return `Error: the data is ${bytes} bytes, more than the ${MAX_DATA_BYTES} byte limit. Send fewer rows or columns.`;
  }

  let config: Record<string, unknown> | undefined;
  if (args.config !== undefined) {
    if (!entry.config_schema) return `Error: ${args.component} takes no config.`;
    const configChecked = jsonSchemaToZod(entry.config_schema).safeParse(args.config);
    if (!configChecked.success) {
      return `Error: config does not match the schema of ${args.component}: ${problems(configChecked.error)}.`;
    }
    config = configChecked.data as Record<string, unknown>;
  }

  const artifact: PluginArtifact = {
    type: "plugin",
    uuid: crypto.randomUUID(),
    name: args.name,
    description: args.description?.trim() || entry.name,
    plugin: { id: entry.plugin, widget: entry.widget },
    data: accepted,
    ...(config ? { config } : {}),
  };
  ctx.artifactQueue.push(messageArtifact(artifact));
  logger.info("show_plugin_artifact emitted", { component: args.component, bytes });
  return (
    `Showed ${entry.name} "${args.name}" in the chat. The user can add it to a dashboard from its card. ` +
    "Do not repeat the data in your text response."
  );
}

export function makePluginArtifactTool(ctx: PluginArtifactContext) {
  return tool({
    description: pluginArtifactDescription,
    inputSchema: pluginArtifactSchema(ctx.catalog),
    execute: async (args) => {
      const a = args as PluginArtifactArgs;
      if (!(a.sql?.trim() || a.from_table_id?.trim())) return runPluginArtifact(a, ctx);
      const entry = ctx.catalog.find((e) => entryId(e) === a.component);
      return runSqlIsolated("show_plugin_artifact", { ...a, catalog: entry ? [entry] : [] }, ctx);
    },
  });
}
