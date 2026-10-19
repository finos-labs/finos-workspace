import { describe, it, expect } from "bun:test";
import { makeMcpTools } from "../../../../src/mcp/factory";
import type { AgentTool } from "../../../../src/protocol/types";

function tool(overrides: Partial<AgentTool>): AgentTool {
  return {
    name: "tool",
    server_id: "srv",
    url: "u",
    ...overrides,
  };
}

describe("makeMcpTools — sanitization", () => {
  it("renames tool names to safe identifiers", () => {
    const out = makeMcpTools([tool({ name: "fetch-webpage" })]);
    expect(out.entries[0].sanitizedName).toBe("fetch_webpage");
    expect(Object.keys(out.toolSet)).toContain("fetch_webpage");
  });

  it("dedupes sanitized collisions with numeric suffixes", () => {
    const out = makeMcpTools([
      tool({ name: "do_thing", server_id: "a" }),
      tool({ name: "do-thing", server_id: "b" }),
      tool({ name: "do.thing", server_id: "c" }),
    ]);
    expect(out.entries.map((e) => e.sanitizedName)).toEqual(["do_thing", "do_thing_2", "do_thing_3"]);
  });
});

describe("makeMcpTools — entries", () => {
  it("preserves serverId, original toolName, and description", () => {
    const out = makeMcpTools([
      tool({ name: "fetch-webpage", server_id: "ines", description: "Fetch a page" }),
    ]);
    expect(out.entries[0]).toMatchObject({
      serverId: "ines",
      toolName: "fetch-webpage",
      sanitizedName: "fetch_webpage",
      description: "Fetch a page",
    });
  });

  it("falls back description to the original tool name when missing", () => {
    const out = makeMcpTools([tool({ name: "x", description: undefined })]);
    expect(out.entries[0].description).toBe("x");
  });
});

describe("makeMcpTools — round-trip nature", () => {
  it("registered tools have NO execute (loop owns dispatch)", () => {
    const out = makeMcpTools([tool({ name: "x" })]);
    expect((out.toolSet.x as { execute?: unknown }).execute).toBeUndefined();
  });
});

describe("makeMcpTools — stopCondition", () => {
  const out = makeMcpTools([tool({ name: "fetch-webpage" })]);

  it("stops when the last step calls a registered MCP tool", () => {
    const result = (out.stopCondition as unknown as (a: { steps: Array<{ toolCalls: Array<{ toolName: string }> }> }) => boolean)({
      steps: [{ toolCalls: [{ toolName: "fetch_webpage" }] }],
    });
    expect(result).toBe(true);
  });

  it("does not stop when the last step calls a non-MCP tool", () => {
    const result = (out.stopCondition as unknown as (a: { steps: Array<{ toolCalls: Array<{ toolName: string }> }> }) => boolean)({
      steps: [{ toolCalls: [{ toolName: "search_widgets" }] }],
    });
    expect(result).toBe(false);
  });

  it("does not stop when there are no steps", () => {
    const result = (out.stopCondition as unknown as (a: { steps: never[] }) => boolean)({ steps: [] });
    expect(result).toBe(false);
  });
});

describe("makeMcpTools — isMcpToolName", () => {
  it("matches sanitized names only", () => {
    const out = makeMcpTools([tool({ name: "fetch-webpage" })]);
    expect(out.isMcpToolName("fetch_webpage")).toBe(true);
    expect(out.isMcpToolName("fetch-webpage")).toBe(false);
    expect(out.isMcpToolName("anything_else")).toBe(false);
  });
});

describe("makeMcpTools — input schema strips x-ines-*", () => {
  it("hides decoration keys from the model-facing input schema", () => {
    const out = makeMcpTools([
      tool({
        name: "query_documents",
        input_schema: {
          properties: {
            query: { type: "string" },
            "x-ines-documents": { type: "array" },
            "x-ines-conversation-id": { type: "string" },
          },
          required: ["query"],
        },
      }),
    ]);
    const t = out.toolSet.query_documents as unknown as { inputSchema: { shape: Record<string, unknown> } };
    const keys = Object.keys(t.inputSchema.shape);
    expect(keys).toContain("query");
    expect(keys).toContain("display_summary");
    expect(keys).not.toContain("x-ines-documents");
    expect(keys).not.toContain("x-ines-conversation-id");
  });
});

describe("makeMcpTools — agent-owned tool names filtered", () => {
  it("drops MCP wrappers whose name matches a vendored bridge command", () => {
    const out = makeMcpTools([
      tool({ name: "manage_dashboard", server_id: "ines" }),
      tool({ name: "create_widget", server_id: "ines" }),
      tool({ name: "fetch_webpage", server_id: "ines" }),
    ]);
    expect(out.entries.map((e) => e.toolName).sort()).toEqual(["fetch_webpage"]);
    expect(Object.keys(out.toolSet)).toEqual(["fetch_webpage"]);
  });

  it("drops MCP wrappers whose name matches an agent SQL tool", () => {
    const out = makeMcpTools([
      tool({ name: "execute_sql", server_id: "ines" }),
      tool({ name: "peek_table", server_id: "ines" }),
      tool({ name: "create_artifact", server_id: "ines" }),
      tool({ name: "fetch_webpage", server_id: "ines" }),
    ]);
    expect(out.entries.map((e) => e.toolName).sort()).toEqual(["fetch_webpage"]);
  });

  it("matches workspace's server-slug-prefixed names too", () => {
    const out = makeMcpTools([
      tool({ name: "inesmcp_manage_dashboard", server_id: "ines" }),
      tool({ name: "inesmcp_execute_sql", server_id: "ines" }),
      tool({ name: "inesmcp_fetch_webpage", server_id: "ines" }),
    ]);
    expect(out.entries.map((e) => e.toolName)).toEqual(["inesmcp_fetch_webpage"]);
  });

  // The bridge mount names `update_widget_layout` differently from its wire
  // command (`update_dashboard_layout`), and get_widget_data/get_skill_content
  // are bridge commands with bespoke agent paths outside WORKSPACE_BRIDGE_COMMANDS.
  // All three must still be deduped or they double-register against native tools.
  it("drops bridge-mount aliases and bespoke round-trip wrappers", () => {
    const out = makeMcpTools([
      tool({ name: "inesmcp_update_widget_layout", server_id: "ines" }),
      tool({ name: "inesmcp_get_skill_content", server_id: "ines" }),
      tool({ name: "inesmcp_web_search", server_id: "ines" }),
    ]);
    expect(out.entries.map((e) => e.toolName)).toEqual(["inesmcp_web_search"]);
    expect(out.widgetDataEntry).toBeUndefined();
  });
});

describe("makeMcpTools — the Workspace's get_widget_data", () => {
  it("is kept, under the name it has on the Workspace's server, with the schema and description the server gives it", () => {
    const out = makeMcpTools([
      tool({
        name: "Workspace_get_widget_data",
        server_id: "workspace",
        description: "Fetch current data for one Workspace data source.",
        input_schema: {
          properties: { origin: { type: "string" }, widget_id: { type: "string" }, data_args: { type: "object" }, widget_uuid: { type: "string" } },
          required: ["origin", "widget_id"],
        },
      }),
    ]);
    expect(out.entries).toEqual([
      {
        serverId: "workspace",
        toolName: "Workspace_get_widget_data",
        sanitizedName: "get_widget_data",
        description: "Fetch current data for one Workspace data source.",
      },
    ]);
    expect(out.widgetDataEntry).toBe(out.entries[0]);
    expect(Object.keys(out.toolSet)).toEqual(["get_widget_data"]);
    expect(out.isMcpToolName("get_widget_data")).toBe(true);
  });

  it("is the first one of the request; any other of that name is dropped, as the agent's own tools are", () => {
    const out = makeMcpTools([
      tool({ name: "Workspace_get_widget_data", server_id: "workspace" }),
      tool({ name: "other_get_widget_data", server_id: "other" }),
    ]);
    expect(out.entries.map((e) => e.serverId)).toEqual(["workspace"]);
  });

  it("is a tool of any server that has one of that name, whichever name the Workspace puts in front", () => {
    expect(makeMcpTools([tool({ name: "get_widget_data" })]).entries[0].sanitizedName).toBe("get_widget_data");
    expect(makeMcpTools([tool({ name: "Open Data Platform_get_widget_data" })]).entries[0].sanitizedName).toBe("get_widget_data");
    expect(makeMcpTools([tool({ name: "not_get_widget_data_at_all" })]).widgetDataEntry).toBeUndefined();
  });
});

describe("makeMcpTools — the Workspace's own tools", () => {
  const workspace = (name: string, overrides: Partial<AgentTool> = {}) =>
    tool({ name: `Workspace_${name}`, server_id: "workspace", ...overrides });
  const request = [
    workspace("get_widget_data"),
    workspace("create_widget", {
      description: "Create one widget on a target dashboard.",
      input_schema: { properties: { origin: { type: "string" }, widget_id: { type: "string" } }, required: ["origin", "widget_id"] },
    }),
    workspace("update_widget"),
    workspace("update_widget_layout"),
    workspace("manage_dashboard"),
    workspace("get_skill_content"),
  ];

  it("are registered, with the schema and the description the Workspace gives them", () => {
    const out = makeMcpTools(request);
    expect(Object.keys(out.toolSet).sort()).toEqual([
      "Workspace_create_widget",
      "Workspace_manage_dashboard",
      "Workspace_update_widget",
      "Workspace_update_widget_layout",
      "get_widget_data",
    ]);
    const create = out.entries.find((entry) => entry.sanitizedName === "Workspace_create_widget");
    expect(create).toEqual({
      serverId: "workspace",
      toolName: "Workspace_create_widget",
      sanitizedName: "Workspace_create_widget",
      description: "Create one widget on a target dashboard.",
    });
    const schema = out.toolSet.Workspace_create_widget as unknown as { inputSchema: { shape: Record<string, unknown> } };
    expect(Object.keys(schema.inputSchema.shape)).toContain("widget_id");
    expect(out.isMcpToolName("Workspace_update_widget")).toBe(true);
  });

  it("are not the ones that skills are read with: those are the agent's", () => {
    const out = makeMcpTools(request);
    expect(out.entries.map((entry) => entry.toolName)).not.toContain("Workspace_get_skill_content");
  });

  it("are the Workspace's by the id of their server, not by their name", () => {
    const out = makeMcpTools(
      [
        tool({ name: "inesmcp_manage_dashboard", server_id: "ines" }),
        tool({ name: "inesmcp_update_widget_layout", server_id: "ines" }),
        tool({ name: "inesmcp_get_widget_data", server_id: "ines" }),
        workspace("manage_dashboard"),
      ],
    );
    expect(out.entries.map((entry) => `${entry.serverId}:${entry.toolName}`)).toEqual([
      "ines:inesmcp_get_widget_data",
      "workspace:Workspace_manage_dashboard",
    ]);
  });

  it("read the widgets with the Workspace's get_widget_data, whichever server lists one first", () => {
    const out = makeMcpTools(
      [tool({ name: "docs_get_widget_data", server_id: "docs" }), workspace("get_widget_data")],
    );
    expect(out.widgetDataEntry?.serverId).toBe("workspace");
    expect(out.entries.map((entry) => entry.serverId)).toEqual(["workspace"]);
  });

  it("are offered, whatever of them is registered: the agent then has no function calls of its own for the Workspace", () => {
    expect(makeMcpTools(request).workspaceToolsOffered).toBe(true);
    expect(makeMcpTools([workspace("read_widget")]).workspaceToolsOffered).toBe(true);
    expect(makeMcpTools([tool({ name: "fetch_webpage", server_id: "ines" })]).workspaceToolsOffered).toBe(false);
    expect(makeMcpTools([]).workspaceToolsOffered).toBe(false);
  });
});
