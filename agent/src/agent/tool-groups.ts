import { tool } from "ai";
import { z } from "zod";
import type { McpToolEntry } from "../mcp/factory.ts";
import type { PluginArtifactEntry } from "../protocol/types.ts";
import { WORKSPACE_SERVER_ID } from "../protocol/workspace-server.ts";

export const CORE_TOOLS: ReadonlySet<string> = new Set([
  "search_widgets",
  "get_widget_data",
  "get_skill_content",
  "recall_conversation",
  "suggest_followups",
  "load_tools",
]);

export interface ToolGroup {
  id: string;
  summary: string;
  tools: string[];
  notes: string;
  always?: true;
}

export interface ToolCatalog {
  groups: ToolGroup[];
  groupOf: ReadonlyMap<string, string>;
}

const SQL_NOTES =
  "- Loaded widget data lives in a per-request SQLite database. A table reported as \"N rows available as table 'foo'\" gives you its SCHEMA, not its rows: any answer that needs row values (filter, aggregate, max/min, average, comparison across rows) comes from execute_sql, never from a row count or a column list.\n" +
  "- Use the exact queryable table and column names the data text and the \"Already Loaded Queryable Tables\" section show, never the widget labels; if a table named for a metric has a generic column like `value`, select it and alias it yourself (`value AS metric_value`). Only call these tools on tables that are already loaded (a widget id or name is not a table until get_widget_data has fetched it), and not in the same batch as the get_widget_data that loads the table.\n" +
  "- If the data is already loaded as a table in this conversation, query it; do not fetch the widget again. If the loaded tables lack a field, fetch a different relevant widget.\n" +
  "- execute_sql: SQLite SELECT/WITH only, up to 1000 rows. Result aliases are not saved as columns: to sort, filter, chart or build an artifact from a derived value, define it in the same SQL (a CTE or subquery). In UNION/INTERSECT/EXCEPT, ORDER BY uses output columns or positions (wrap the query in an outer SELECT for a custom sort). Window functions cover moving averages, rankings and cumulative sums.\n" +
  "- peek_table / peek_column_values: cheap previews; peek_table first when names are uncertain (never PRAGMA or SQLite internals). A query that returns 0 rows is not an answer: check the exact values with peek_column_values or SELECT DISTINCT.\n" +
  "- create_artifact renders a table inline. Pass exactly ONE source: `sql`, `from_table_id` (one loaded table as it is) or `data` (raw rows). Call it once per artifact, then go to the final answer. For tabular results and for CSV/export/download/full-table requests use it instead of writing Markdown or CSV rows; keep the final text to the interpretation and the key figures.\n" +
  "- The FINOS Workspace has no chart artifact: draw a chart as HTML/SVG with create_html_artifact (in the `render` group) from the rows you queried, following the `html-chart` skill. Check that the table has the columns first; never invent trend columns from a snapshot table.\n" +
  "- DEFAULT to these tools for filter / aggregate / chart / table tasks.";

const DASHBOARD_NOTES =
  "You change the user's dashboard through the browser. Use these tools only when the user asks to modify the dashboard or a widget's configuration; a parameter-level imperative like 'update/set/change <param> to <value>' counts even when the word 'widget' or 'dashboard' is absent: call update_widget_in_dashboard on the visible widgets exposing that parameter, or only the named widget when the user names one. " +
  "Read each tool's description first. Identify target widgets from the lists of widgets in this prompt, use their widget_uuid, and update only widgets that actually expose the parameter. " +
  "add_widget_to_dashboard adds a connected/catalog widget to the current tab by its origin and widget_id (from the lists or search_widgets). add_generative_widget creates inline note/table/chart/html content (inner_tab places it on another tab). " +
  "manage_navigation_bar creates or edits tabs: operation 'create'/'add_tabs'/'remove_tabs' with tabs:[{name}], or 'rename_tabs' with rename_map:{oldId:newName}. " +
  "For enum/dropdown/dynamic parameters call get_params_options when needed and pass exact option values, not display labels; for plain string parameters keep the user's literal value and casing unless the schema or options prove otherwise. Omit optional IDs you have no concrete value for.";

const WORKSPACE_NOTES =
  "These are the FINOS Workspace's own tools; each runs in the user's browser, as the user. Use the ones that change something only when the user asks to modify the dashboard or a widget's configuration; a parameter-level imperative like 'update/set/change <param> to <value>' counts even when the word 'widget' or 'dashboard' is absent: update the visible widgets exposing that parameter, or only the named widget when the user names one. " +
  "Read each tool's description first. Identify target widgets from the lists of widgets in this prompt (use their widget_uuid) or from the snapshot, and update only widgets that actually expose the parameter. " +
  "create_widget adds a catalog widget to a dashboard by its origin and widget_id (from the lists, search_widgets or list_available_widgets; get_widget_schema says its parameters). add_generative_widget creates inline note/html content. manage_navigation_bar creates or edits tabs. " +
  "For enum/dropdown/dynamic parameters call get_params_options and pass exact option values, not display labels; for plain string parameters keep the user's literal value and casing unless the schema or options prove otherwise. Omit optional IDs you have no concrete value for. " +
  "A widget tagged [iframe] is changed like any other: update_widget hands the new parameters to its page (see WIDGETS). " +
  "A result says ok: false and why when a call did not work: read it, fix the call or say that it cannot be done, and never say that something changed unless a result says it did.";

const APPS_NOTES =
  "- create_app assembles connected widgets into a multi-tab dashboard app the user can open or save. Call search_widgets first and pass each widget's (origin, widget_id) with grid x/y/w/h.";

const RENDER_NOTES =
  "- create_html_artifact: render a small inline HTML report or chart (max 50 KB) for a one-off layout; after create_artifact-style rendering succeeds, do not repeat the markup in the answer. For flowchart-like renders prefer a Mermaid diagram tool when one is listed, with `flowchart TD`.\n" +
  "- create_table_from_text: extract a JSON table from pasted unstructured text; the result is queryable with execute_sql (the `sql` group).";

const COMPONENT_NOTES =
  "- show_plugin_artifact shows a plugin's component (the `component` list in the tool says which, what each is for, and the data each takes) in the chat, filled with data you have. Give `data` as the component's schema says. For rows you loaded, use `sql` or `from_table_id` with `rows_key` instead of copying them. The user can add the card to a dashboard as a widget. Call it once per component shown, then go to the final answer and do not repeat the data.";

const PLANNING_NOTES =
  "- _llm_think: show a short plan before a multi-step workflow: `summary` is one concise sentence, the step-by-step plan goes only in `plan`. One workflow-level plan, not repeated planning between routine tool calls. Do not name tools, ids or tables in it.\n" +
  "- enhance_prompt: rewrite a vague user query into a sharper one; only when the wording is genuinely ambiguous.";

const DOCUMENT_NOTES =
  "- query_documents searches a loaded file (PDF, DOCX, TXT, MD, HTML) by question: pass the question and doc_ids [the file widget's uuid]. Every passage it returns is tagged with its page: say the page in your answer. Never guess what is in a file; if it cannot be read, say so.\n" +
  "- A file widget holds no data until get_widget_data has loaded it (that call also loads it for searching); query_documents finds nothing in a file that was never loaded. list_documents says what is loaded.";

const WEB_SEARCH_NOTE = "web_search finds current information (use the year of CURRENT DATE for recent events)";
const WEB_FETCH_NOTE =
  "fetch_webpage returns an overview of a page and a page_id, not the page; read only what you need with inspect_webpage (text from an offset, a phrase, a CSS selector, links, tables that load for SQL, embedded JSON, the source)";
const WEB_NOTES = `- ${WEB_SEARCH_NOTE}; ${WEB_FETCH_NOTE}. Cite what you take from them.`;

function describeWebGroup(tools: readonly string[]): { summary: string; notes: string } {
  const search = tools.some((name) => endsWithCanonical(name, "web_search"));
  const fetch = tools.some((name) => endsWithCanonical(name, "fetch_webpage"));
  if (search && !fetch) {
    return { summary: "search the web", notes: `- ${WEB_SEARCH_NOTE}. Cite what you take from it.` };
  }
  if (fetch && !search) {
    return { summary: "read a web page", notes: `- ${WEB_FETCH_NOTE}. Cite what you take from it.` };
  }
  return { summary: "search the web, or read a web page", notes: WEB_NOTES };
}

const MAX_LISTED_COMPONENTS = 12;
const MAX_COMPONENT_CHARS = 140;

function describeComponentsGroup(
  _tools: readonly string[],
  components: readonly PluginArtifactEntry[],
): { summary: string; notes: string } {
  const listed = components
    .slice(0, MAX_LISTED_COMPONENTS)
    .map((c) => {
      const text = `${c.name}: ${c.description}`;
      return text.length > MAX_COMPONENT_CHARS ? `${text.slice(0, MAX_COMPONENT_CHARS - 1)}…` : text;
    })
    .join(" | ");
  return {
    summary: `show one of the user's plugin components in the chat, filled with your data (the user can add it to a dashboard): ${listed}`,
    notes: COMPONENT_NOTES,
  };
}

interface StaticGroup {
  id: string;
  summary: string;
  notes: string;
  names: readonly string[];
  mcp?: true;
  describe?: (
    tools: readonly string[],
    components: readonly PluginArtifactEntry[],
  ) => { summary: string; notes: string };
  server?: string;
  always?: true;
}

const STATIC_GROUPS: readonly StaticGroup[] = [
  {
    id: "sql",
    summary: "query the tables you have loaded and show results as table artifacts",
    notes: SQL_NOTES,
    names: ["execute_sql", "peek_table", "peek_column_values", "create_artifact"],
  },
  {
    id: "dashboard",
    summary: "change the user's dashboard: add, update or remove widgets, edit tabs and widget parameters",
    notes: DASHBOARD_NOTES,
    names: [
      "update_widget_in_dashboard",
      "add_widget_to_dashboard",
      "add_generative_widget",
      "manage_navigation_bar",
      "get_params_options",
      "assign_tasks_to_agents",
    ],
  },
  {
    id: "workspace",
    summary: "look at and change the user's FINOS Workspace: find and add widgets, update a widget's parameters, edit tabs, navigate",
    notes: WORKSPACE_NOTES,
    names: [],
    mcp: true,
    server: WORKSPACE_SERVER_ID,
    always: true,
  },
  {
    id: "apps",
    summary: "assemble connected widgets into a multi-tab dashboard app the user can open or save",
    notes: APPS_NOTES,
    names: ["create_app"],
  },
  {
    id: "render",
    summary: "draw one-off HTML/SVG (also charts) or turn pasted text into a table",
    notes: RENDER_NOTES,
    names: ["create_html_artifact", "create_table_from_text"],
  },
  {
    id: "components",
    summary: "show a plugin component in the chat, filled with your data",
    notes: COMPONENT_NOTES,
    names: ["show_plugin_artifact"],
    describe: describeComponentsGroup,
  },
  {
    id: "planning",
    summary: "show a short plan before a multi-step task, or sharpen a vague question",
    notes: PLANNING_NOTES,
    names: ["_llm_think", "enhance_prompt"],
  },
  {
    id: "documents",
    summary: "search a loaded PDF/DOCX/TXT/MD/HTML by question, with pages",
    notes: DOCUMENT_NOTES,
    names: ["query_documents", "list_documents"],
    mcp: true,
  },
  {
    id: "web",
    summary: "search the web, or read a web page",
    notes: WEB_NOTES,
    names: ["web_search", "fetch_webpage", "inspect_webpage"],
    mcp: true,
    describe: describeWebGroup,
  },
];

function endsWithCanonical(name: string, canonical: string): boolean {
  return name === canonical || name.endsWith(`_${canonical}`);
}

export function buildToolCatalog(
  toolNames: readonly string[],
  mcpEntries: readonly McpToolEntry[],
  components: readonly PluginArtifactEntry[] = [],
): ToolCatalog {
  const mcpByName = new Map(mcpEntries.map((entry) => [entry.sanitizedName, entry]));
  const groups: ToolGroup[] = [];
  const groupOf = new Map<string, string>();

  for (const spec of STATIC_GROUPS) {
    const tools = toolNames.filter((name) => {
      if (CORE_TOOLS.has(name)) return false;
      const isMcp = mcpByName.has(name);
      if (isMcp !== (spec.mcp === true)) return false;
      if (spec.server !== undefined) return mcpByName.get(name)?.serverId === spec.server;
      return spec.names.some((canonical) => (isMcp ? endsWithCanonical(name, canonical) : name === canonical));
    });
    if (tools.length === 0) continue;
    groups.push({
      id: spec.id,
      tools,
      ...(spec.describe?.(tools, components) ?? { summary: spec.summary, notes: spec.notes }),
      ...(spec.always ? { always: true as const } : {}),
    });
    for (const name of tools) groupOf.set(name, spec.id);
  }
  return { groups, groupOf };
}


export function activeToolNames(catalog: ToolCatalog, toolNames: readonly string[], loaded: ReadonlySet<string>): string[] {
  const always = new Set(catalog.groups.filter((g) => g.always).map((g) => g.id));
  return toolNames.filter((name) => {
    const group = catalog.groupOf.get(name);
    return group === undefined || always.has(group) || loaded.has(group);
  });
}

export function groupsOfCalledTools(catalog: ToolCatalog, calledTools: Iterable<string>): string[] {
  const groups = new Set<string>();
  for (const name of calledTools) {
    const group = catalog.groupOf.get(name);
    if (group) groups.add(group);
  }
  return [...groups];
}

export function renderToolCatalog(catalog: ToolCatalog, loaded: ReadonlySet<string>): string {
  const deferred = catalog.groups.filter((g) => !g.always);
  if (deferred.length === 0) return "";
  const lines = deferred.map((g) => {
    const state = loaded.has(g.id) ? " [loaded]" : "";
    return `- ${g.id}${state} — ${g.summary}. Tools: ${g.tools.join(", ")}`;
  });
  return (
    "\nMORE TOOLS (not in your tool list until loaded):\n" +
    "Your tool list holds the tools every question can need. The groups below hold the rest. To use one, call load_tools with its name (several at once is fine), then use the tools on your next step. " +
    "Load the groups a task needs before you start it; do not tell the user a capability is unavailable if a group here provides it.\n" +
    lines.join("\n")
  );
}

export function renderToolNotes(catalog: ToolCatalog, loaded: ReadonlySet<string>): string {
  const parts = catalog.groups
    .filter((g) => (g.always || loaded.has(g.id)) && g.notes)
    .map((g) => `${g.id.toUpperCase()} TOOLS:\n${g.notes}`);
  return parts.length > 0 ? `\n${parts.join("\n\n")}` : "";
}

export interface LoadToolsOptions {
  catalog: ToolCatalog;
  loaded: Set<string>;
}

export function makeLoadToolsTool({ catalog, loaded }: LoadToolsOptions) {
  const ids = catalog.groups.filter((g) => !g.always).map((g) => g.id);
  return tool({
    description:
      "Load tool groups from the MORE TOOLS list in the system prompt. Their tools and instructions are available from your next step.",
    inputSchema: z.object({
      groups: z
        .array(z.string())
        .min(1)
        .describe(`Group names, e.g. ["${ids[0] ?? "sql"}"]. One of: ${ids.join(", ")}.`),
    }),
    execute: async ({ groups }) => {
      const byId = new Map(catalog.groups.map((g) => [g.id, g]));
      const nowLoaded: string[] = [];
      const alreadyLoaded: string[] = [];
      const unknown: string[] = [];
      for (const raw of groups) {
        const id = raw.trim();
        const group = byId.get(id) ?? byId.get(id.toLowerCase());
        if (!group) {
          unknown.push(raw);
          continue;
        }
        if (group.always || loaded.has(group.id)) {
          alreadyLoaded.push(group.id);
          continue;
        }
        loaded.add(group.id);
        nowLoaded.push(group.id);
      }
      const toolsOf = (list: string[]) => list.flatMap((id) => byId.get(id)?.tools ?? []);
      return {
        loaded: nowLoaded,
        tools: toolsOf(nowLoaded),
        ...(alreadyLoaded.length > 0 ? { already_loaded: alreadyLoaded } : {}),
        ...(unknown.length > 0 ? { unknown, available: ids } : {}),
        next: nowLoaded.length > 0 ? "Use these tools now; their instructions are in your system prompt." : undefined,
      };
    },
  });
}
