import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CopilotAccess, useCopilotAccessStore } from "~/lib/state/copilotAccess";
import { type McpServer, useMcpToolsStore } from "~/lib/state/mcpTools";

const server = (id: string, url: string, tools: string[]): McpServer => ({
  id,
  name: id,
  url,
  enabled: true,
  toolsEnabled: true,
  tools: tools.map((tool) => ({ id: tool, name: tool, enabled: true })),
});

const ready = { state: "ready", retry: () => {} } as never;

const grants = (mcp: CopilotAccess["mcp"]): CopilotAccess => ({ models: [], mcp });

describe("reconnecting when the tools are read for a chat request", () => {
  const withConnection = (state: string) => {
    const retry = vi.fn();
    useMcpToolsStore.setState({
      servers: [server("docs", "https://docs.example.com/mcp", ["search"])],
      mcpConnectionRegistry: { docs: { state, retry } as never },
    });
    useCopilotAccessStore
      .getState()
      .setAccess(
        grants([{ server_url: "https://docs.example.com/mcp", tool_name: "*" }]),
      );
    return retry;
  };

  afterEach(() => {
    useCopilotAccessStore.getState().setAccess(null);
  });

  it("leaves a ready connection alone, because reconnecting tears down what is using it", async () => {
    const retry = withConnection("ready");

    await useMcpToolsStore.getState().getEnabledToolsForAgent();

    expect(retry).not.toHaveBeenCalled();
  });

  it("tries a failed connection again", async () => {
    const retry = withConnection("failed");

    await useMcpToolsStore.getState().getEnabledToolsForAgent();

    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("MCP tools and what the user's roles grant", () => {
  beforeEach(() => {
    useMcpToolsStore.setState({
      servers: [
        server("docs", "https://docs.example.com/mcp", ["search", "delete"]),
        server("db", "https://db.example.com/mcp", ["query"]),
      ],
      mcpConnectionRegistry: { docs: ready, db: ready },
    });
  });

  afterEach(() => {
    useCopilotAccessStore.getState().setAccess(null);
  });

  it("sends no tool while the access is not loaded", async () => {
    const tools = await useMcpToolsStore.getState().getEnabledToolsForAgent();

    expect(tools).toEqual([]);
    expect(useMcpToolsStore.getState().getEnabledToolCount()).toBe(0);
  });

  it("sends no tool when no role grants one", async () => {
    useCopilotAccessStore.getState().setAccess(grants([]));

    const tools = await useMcpToolsStore.getState().getEnabledToolsForAgent();

    expect(tools).toEqual([]);
    expect(useMcpToolsStore.getState().getEnabledToolCount()).toBe(0);
  });

  it("sends only the granted tools of the granted servers", async () => {
    useCopilotAccessStore.getState().setAccess(
      grants([
        { server_url: "https://docs.example.com/mcp", tool_name: "search" },
        { server_url: "https://db.example.com/mcp", tool_name: "*" },
      ]),
    );

    const tools = await useMcpToolsStore.getState().getEnabledToolsForAgent();

    expect(tools.map((t) => `${t.server_id}:${t.tool_name}`)).toEqual([
      "docs:search",
      "db:query",
    ]);
    expect(useMcpToolsStore.getState().getEnabledToolCount()).toBe(2);
  });

  it("sends no tool of a server that is not granted", async () => {
    useCopilotAccessStore
      .getState()
      .setAccess(
        grants([{ server_url: "https://db.example.com/mcp", tool_name: "*" }]),
      );

    const tools = await useMcpToolsStore.getState().getEnabledToolsForAgent();

    expect(tools.map((t) => t.server_id)).toEqual(["db"]);
  });
});
