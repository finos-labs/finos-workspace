import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { asSchema } from "ai";
import { clearMcpToolCache, mcpTool } from "../../../../src/mcp/schema.ts";
import { makeMcpTools } from "../../../../src/mcp/factory.ts";
import type { AgentTool } from "../../../../src/protocol/types.ts";

const schema = {
  properties: { q: { type: "string", description: "What to look for" }, n: { type: "number" } },
  required: ["q"],
};

function agentTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return { name: "search", server_id: "srv", url: "u", description: "Search", input_schema: schema, ...overrides };
}

describe("mcpTool", () => {
  beforeEach(() => clearMcpToolCache());

  it("builds a tool once for one definition and hands the same one to every request", () => {
    expect(mcpTool("Search", schema)).toBe(mcpTool("Search", { ...schema }));
  });

  it("builds another for another description or another schema", () => {
    const base = mcpTool("Search", schema);
    expect(mcpTool("Search the web", schema)).not.toBe(base);
    expect(mcpTool("Search", { ...schema, required: [] })).not.toBe(base);
    expect(mcpTool("Search", undefined)).not.toBe(base);
  });

  it("converts the schema to JSON Schema once, however many model steps use the tool", () => {
    const built = mcpTool("Search", schema);
    const first = asSchema(built.inputSchema).jsonSchema;
    expect(asSchema(built.inputSchema).jsonSchema).toBe(first);
    expect(asSchema(mcpTool("Search", schema).inputSchema).jsonSchema).toBe(first);
  });

  it("keeps what the model is told: the description, the arguments and the display summary", () => {
    const built = mcpTool("Search", schema);
    expect(built.description).toBe("Search");
    const json = asSchema(built.inputSchema).jsonSchema as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(json.properties).sort()).toEqual(["display_summary", "n", "q"]);
    expect(json.required).toEqual(["q"]);
  });

  it("still checks the arguments the model sends", async () => {
    const built = mcpTool("Search", schema);
    const checked = asSchema(built.inputSchema);
    const good = await checked.validate?.({ q: "x", n: 1 });
    const bad = await checked.validate?.({ n: 1 });
    expect(good?.success).toBe(true);
    expect(bad?.success).toBe(false);
  });

  it("does not hold what it is not asked about: an unknown definition builds fresh", () => {
    const one = mcpTool("A", { properties: { a: { type: "string" } } });
    const other = mcpTool("A", { properties: { b: { type: "string" } } });
    const json = (t: ReturnType<typeof mcpTool>) =>
      Object.keys((asSchema(t.inputSchema).jsonSchema as { properties: Record<string, unknown> }).properties);
    expect(json(one)).toContain("a");
    expect(json(one)).not.toContain("b");
    expect(json(other)).toContain("b");
  });
});

describe("makeMcpTools with the cache", () => {
  beforeEach(() => clearMcpToolCache());

  it("gives two requests with the same tools the same tool objects", () => {
    const first = makeMcpTools([agentTool(), agentTool({ name: "other", description: "Other" })]);
    const second = makeMcpTools([agentTool(), agentTool({ name: "other", description: "Other" })]);
    expect(second.toolSet.search).toBe(first.toolSet.search);
    expect(second.toolSet.other).toBe(first.toolSet.other);
  });

  it("shares a tool between two names, since the name is not part of the tool", () => {
    const out = makeMcpTools([agentTool({ name: "a-search", server_id: "x" }), agentTool({ name: "b-search", server_id: "y" })]);
    expect(out.toolSet.a_search).toBe(out.toolSet.b_search);
  });
});
