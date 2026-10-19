import { describe, it, expect } from "bun:test";
import {
  activeToolNames,
  buildToolCatalog,
  CORE_TOOLS,
  groupsOfCalledTools,
  makeLoadToolsTool,
  renderToolCatalog,
  renderToolNotes,
} from "../../../../src/agent/tool-groups";
import type { McpToolEntry } from "../../../../src/mcp/factory";

const entry = (sanitizedName: string, description = "Does a thing. More detail follows."): McpToolEntry => ({
  serverId: "s",
  toolName: sanitizedName,
  sanitizedName,
  description,
});

const AGENT_TOOLS = [
  "search_widgets", "get_widget_data", "get_skill_content", "recall_conversation",
  "execute_sql", "peek_table", "peek_column_values", "create_artifact",
  "update_widget_in_dashboard", "manage_navigation_bar", "create_app",
  "create_html_artifact", "create_table_from_text", "_llm_think", "enhance_prompt",
];
const MCP = [entry("Ines_Tools_web_search"), entry("Ines_Tools_query_documents")];
const ALL = [...AGENT_TOOLS, ...MCP.map((e) => e.sanitizedName)];

describe("the web group of a user who has only one of the web tools", () => {
  const SEARCH = entry("Ines_Tools_web_search");
  const FETCH = entry("Ines_Tools_fetch_webpage");
  const INSPECT = entry("Ines_Tools_inspect_webpage");
  const webGroup = (mcp: McpToolEntry[]) =>
    buildToolCatalog([...AGENT_TOOLS, ...mcp.map((e) => e.sanitizedName)], mcp).groups.find((g) => g.id === "web");

  it("is described as both when the user has both", () => {
    const web = webGroup([SEARCH, FETCH, INSPECT]);
    expect(web?.tools).toEqual(["Ines_Tools_web_search", "Ines_Tools_fetch_webpage", "Ines_Tools_inspect_webpage"]);
    expect(web?.summary).toBe("search the web, or read a web page");
    expect(web?.notes).toContain("web_search");
    expect(web?.notes).toContain("fetch_webpage");
    expect(web?.notes).toContain("inspect_webpage");
  });

  it("is only search when reading pages is switched off, and says nothing of the tool it has not", () => {
    const web = webGroup([SEARCH]);
    expect(web?.tools).toEqual(["Ines_Tools_web_search"]);
    expect(web?.summary).toBe("search the web");
    expect(web?.notes).toContain("web_search");
    expect(web?.notes).not.toContain("fetch_webpage");
  });

  it("is only reading when searching is switched off, and says nothing of the tool it has not", () => {
    const web = webGroup([FETCH, INSPECT]);
    expect(web?.tools).toEqual(["Ines_Tools_fetch_webpage", "Ines_Tools_inspect_webpage"]);
    expect(web?.summary).toBe("read a web page");
    expect(web?.notes).toContain("fetch_webpage");
    expect(web?.notes).not.toContain("web_search");
  });

  it("is no group at all when both are switched off", () => {
    expect(webGroup([])).toBeUndefined();
  });
});

describe("the group of the Workspace's own tools", () => {
  const workspace = (name: string): McpToolEntry => ({
    serverId: "workspace",
    toolName: `Workspace_${name}`,
    sanitizedName: name === "get_widget_data" ? name : `Workspace_${name}`,
    description: `${name}.`,
  });
  const TOOLS = ["get_widget_data", "create_widget", "update_widget", "manage_dashboard"].map(workspace);
  const catalogOf = (mcp: McpToolEntry[], agentTools: string[] = AGENT_TOOLS) =>
    buildToolCatalog([...agentTools, ...mcp.map((e) => e.sanitizedName)], mcp);

  it("holds every tool of the Workspace's server but the one that reads a widget, which every question can need", () => {
    const group = catalogOf(TOOLS).groups.find((g) => g.id === "workspace");
    expect(group?.tools).toEqual(["Workspace_create_widget", "Workspace_update_widget", "Workspace_manage_dashboard"]);
    expect(catalogOf(TOOLS).groupOf.has("get_widget_data")).toBe(false);
  });

  it("is told by the server, not by the names of its tools", () => {
    const other: McpToolEntry = { serverId: "docs", toolName: "docs_update_widget", sanitizedName: "docs_update_widget", description: "x." };
    const c = catalogOf([...TOOLS, other]);
    expect(c.groups.find((g) => g.id === "workspace")?.tools).not.toContain("docs_update_widget");
    expect(c.groupOf.has("docs_update_widget")).toBe(false);
  });

  it("has its instructions in the prompt without being loaded", () => {
    const c = catalogOf(TOOLS);
    expect(renderToolNotes(c, new Set())).toContain("WORKSPACE TOOLS:");
    expect(renderToolNotes(c, new Set())).toContain("never say that something changed unless a result says it did");
  });

  it("is not in the catalog of what can be loaded: its tools are given, with their descriptions and parameters", () => {
    const c = catalogOf(TOOLS);
    expect(renderToolCatalog(c, new Set())).not.toContain("- workspace");
    expect(renderToolCatalog(c, new Set())).not.toContain("Workspace_update_widget");
    const active = activeToolNames(c, [...AGENT_TOOLS, ...TOOLS.map((e) => e.sanitizedName)], new Set());
    expect(active).toContain("Workspace_update_widget");
    expect(active).toContain("Workspace_create_widget");
    expect(active).not.toContain("update_widget_in_dashboard");
  });

  it("is not something that load_tools loads, and says so when asked", async () => {
    const c = catalogOf(TOOLS);
    const loaded = new Set<string>();
    const out = (await makeLoadToolsTool({ catalog: c, loaded }).execute!(
      { groups: ["workspace"] },
      { toolCallId: "1", messages: [] },
    )) as { loaded: string[]; already_loaded?: string[] };
    expect(out.loaded).toEqual([]);
    expect(out.already_loaded).toEqual(["workspace"]);
    expect(loaded.size).toBe(0);
  });

  it("is no group when the request has none of the Workspace's tools but the one that reads a widget", () => {
    expect(catalogOf([workspace("get_widget_data")]).groups.find((g) => g.id === "workspace")).toBeUndefined();
  });
});

describe("buildToolCatalog", () => {
  const catalog = buildToolCatalog(ALL, MCP);
  const group = (id: string) => catalog.groups.find((g) => g.id === id);

  it("keeps the tools every question can need out of every group", () => {
    for (const core of ["search_widgets", "get_widget_data", "get_skill_content", "recall_conversation"]) {
      expect(catalog.groupOf.has(core)).toBe(false);
    }
  });

  it("groups the agent's own tools by what they are for", () => {
    expect(group("sql")?.tools).toEqual(["execute_sql", "peek_table", "peek_column_values", "create_artifact"]);
    expect(group("dashboard")?.tools).toEqual(["update_widget_in_dashboard", "manage_navigation_bar"]);
    expect(group("apps")?.tools).toEqual(["create_app"]);
    expect(group("render")?.tools).toEqual(["create_html_artifact", "create_table_from_text"]);
    expect(group("planning")?.tools).toEqual(["_llm_think", "enhance_prompt"]);
  });

  it("groups MCP tools by their canonical name, however the Workspace prefixed it", () => {
    expect(group("web")?.tools).toEqual(["Ines_Tools_web_search"]);
    expect(group("documents")?.tools).toEqual(["Ines_Tools_query_documents"]);
  });

  it("does not take an MCP tool for an agent tool of the same name, nor the other way round", () => {
    const c = buildToolCatalog(["execute_sql", "Other_execute_sql"], [entry("Other_execute_sql")]);
    expect(c.groupOf.get("execute_sql")).toBe("sql");
    // An MCP tool that no group claims is never deferred.
    expect(c.groupOf.has("Other_execute_sql")).toBe(false);
  });

  it("does not defer a tool of a server the user connected: it has no group, so its definition is always given", () => {
    const c = buildToolCatalog(["acme_lookup"], [entry("acme_lookup", "Look up a company. It returns a profile.")]);
    expect(c.groups).toEqual([]);
    expect(c.groupOf.has("acme_lookup")).toBe(false);
    expect(activeToolNames(c, ["acme_lookup"], new Set())).toEqual(["acme_lookup"]);
  });

  it("has only the groups of tools that exist", () => {
    const c = buildToolCatalog(["search_widgets", "execute_sql"], []);
    expect(c.groups.map((g) => g.id)).toEqual(["sql"]);
  });

  it("leaves an in-process tool that no group claims as a core one", () => {
    const c = buildToolCatalog(["mystery_tool"], []);
    expect(c.groups).toEqual([]);
    expect(c.groupOf.has("mystery_tool")).toBe(false);
  });
});

describe("activeToolNames", () => {
  const catalog = buildToolCatalog(ALL, MCP);

  it("gives the core tools and nothing else when no group is loaded", () => {
    expect(activeToolNames(catalog, ALL, new Set())).toEqual(["search_widgets", "get_widget_data", "get_skill_content", "recall_conversation"]);
  });

  it("adds the tools of the groups that are loaded", () => {
    const active = activeToolNames(catalog, ALL, new Set(["sql"]));
    expect(active).toEqual(expect.arrayContaining(["execute_sql", "create_artifact", "search_widgets"]));
    expect(active).not.toContain("update_widget_in_dashboard");
  });

  it("ignores a group that does not exist", () => {
    expect(activeToolNames(catalog, ALL, new Set(["nonsense"]))).toHaveLength(4);
  });
});

describe("groupsOfCalledTools", () => {
  const catalog = buildToolCatalog(ALL, MCP);

  it("names the groups of the tools that were used, once each", () => {
    expect(groupsOfCalledTools(catalog, ["execute_sql", "peek_table", "search_widgets", "Ines_Tools_web_search"]).sort()).toEqual(["sql", "web"]);
  });

  it("names none for core tools, or tools it does not know", () => {
    expect(groupsOfCalledTools(catalog, ["get_widget_data", "unknown_tool"])).toEqual([]);
  });
});

describe("rendering", () => {
  const catalog = buildToolCatalog(ALL, MCP);

  it("lists every group once, with its tools, and marks the loaded ones", () => {
    const out = renderToolCatalog(catalog, new Set(["sql"]));
    expect(out.match(/^- /gm)).toHaveLength(catalog.groups.length);
    expect(out).toContain("- sql [loaded] —");
    expect(out).toContain("Tools: execute_sql, peek_table, peek_column_values, create_artifact");
    expect(out).not.toContain("- web [loaded]");
  });

  it("is empty when there are no groups", () => {
    expect(renderToolCatalog({ groups: [], groupOf: new Map() }, new Set())).toBe("");
  });

  it("gives instructions for the loaded groups only, each under its own heading", () => {
    const out = renderToolNotes(catalog, new Set(["sql", "documents"]));
    expect(out).toContain("SQL TOOLS:");
    expect(out).toContain("DOCUMENTS TOOLS:");
    expect(out).not.toContain("DASHBOARD TOOLS:");
    expect(renderToolNotes(catalog, new Set())).toBe("");
  });
});

describe("load_tools", () => {
  const catalog = buildToolCatalog(ALL, MCP);
  const run = async (loaded: Set<string>, groups: string[]) => {
    const t = makeLoadToolsTool({ catalog, loaded });
    return (await t.execute!({ groups }, { toolCallId: "1", messages: [] })) as Record<string, unknown>;
  };

  it("loads the groups it is asked for and says which tools they bring", async () => {
    const loaded = new Set<string>();
    const out = await run(loaded, ["sql", "render"]);
    expect([...loaded]).toEqual(["sql", "render"]);
    expect(out.loaded).toEqual(["sql", "render"]);
    expect(out.tools).toEqual(["execute_sql", "peek_table", "peek_column_values", "create_artifact", "create_html_artifact", "create_table_from_text"]);
  });

  it("says that a group was already loaded instead of loading it again", async () => {
    const out = await run(new Set(["sql"]), ["sql"]);
    expect(out.loaded).toEqual([]);
    expect(out.already_loaded).toEqual(["sql"]);
  });

  it("names what it does not know, and what there is", async () => {
    const out = await run(new Set(), ["teleport"]);
    expect(out.unknown).toEqual(["teleport"]);
    expect(out.available).toContain("sql");
    expect(out.loaded).toEqual([]);
  });

  it("takes the name however it is cased or spaced", async () => {
    const loaded = new Set<string>();
    await run(loaded, [" SQL "]);
    expect([...loaded]).toEqual(["sql"]);
  });

  it("is not a tool it could load", () => {
    expect(CORE_TOOLS.has("load_tools")).toBe(true);
    expect(catalog.groupOf.has("load_tools")).toBe(false);
  });
});
