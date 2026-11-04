import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceTools } from "~/api/workspaceTools.api";
import { useAuthStore } from "~/lib/state/auth";
import { type CopilotAccess, useCopilotAccessStore } from "~/lib/state/copilotAccess";
import { useMcpToolsStore } from "~/lib/state/mcpTools";
import {
  getWorkspaceAgentTools,
  resetWorkspaceAgentTools,
  WORKSPACE_SERVER_ID,
  workspaceToolName,
} from "~/lib/state/workspaceTools";

vi.mock("~/api/workspaceTools.api", () => ({
  getWorkspaceTools: vi.fn(),
}));

const URL = "http://localhost:8000/app/workspace-tools";
const SCHEMA = { type: "object", properties: { origin: { type: "string" } } };
const TOOLS = {
  url: URL,
  tools: [
    { name: "get_widget_data", description: "Fetch widget data.", inputSchema: SCHEMA },
    { name: "read_widget", description: null, inputSchema: { type: "object" } },
  ],
};

const signIn = (uuid: string | undefined) =>
  useAuthStore.setState({ user: uuid ? ({ uuid } as never) : null } as never);

beforeEach(() => {
  vi.mocked(getWorkspaceTools).mockReset();
  vi.mocked(getWorkspaceTools).mockResolvedValue(TOOLS);
  resetWorkspaceAgentTools();
  signIn("user-1");
});

afterEach(() => {
  signIn(undefined);
  resetWorkspaceAgentTools();
  useCopilotAccessStore.getState().setAccess(null);
  useMcpToolsStore.setState({ servers: [], mcpConnectionRegistry: {} });
});

describe("the name of a tool", () => {
  it("is the one the FINOS Workspace's server gives it, without the server's name in front", () => {
    expect(workspaceToolName("Workspace_get_widget_data")).toBe("get_widget_data");
    expect(workspaceToolName("get_widget_data")).toBe("get_widget_data");
    expect(workspaceToolName("Other_get_widget_data")).toBe("Other_get_widget_data");
  });
});

describe("the tools of the FINOS Workspace for an agent request", () => {
  it("are the tools the FINOS Workspace describes, as tools of its own server", async () => {
    expect(await getWorkspaceAgentTools()).toEqual([
      {
        server_id: WORKSPACE_SERVER_ID,
        name: "Workspace_get_widget_data",
        tool_name: "get_widget_data",
        description: "Fetch widget data.",
        url: URL,
        input_schema: SCHEMA,
      },
      {
        server_id: WORKSPACE_SERVER_ID,
        name: "Workspace_read_widget",
        tool_name: "read_widget",
        description: undefined,
        url: URL,
        input_schema: { type: "object" },
      },
    ]);
  });

  it("are not asked for without a signed-in user", async () => {
    signIn(undefined);
    expect(await getWorkspaceAgentTools()).toEqual([]);
    expect(getWorkspaceTools).not.toHaveBeenCalled();
  });

  it("are asked for once for a session, however many requests the agent gets", async () => {
    await getWorkspaceAgentTools();
    await getWorkspaceAgentTools();
    await Promise.all([getWorkspaceAgentTools(), getWorkspaceAgentTools()]);
    expect(getWorkspaceTools).toHaveBeenCalledTimes(1);
  });

  it("are asked for again by the next user", async () => {
    await getWorkspaceAgentTools();
    signIn("user-2");
    await getWorkspaceAgentTools();
    expect(getWorkspaceTools).toHaveBeenCalledTimes(2);
  });

  it("leave the agent without them when the FINOS Workspace cannot say, and the next request asks again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getWorkspaceTools).mockRejectedValueOnce(new Error("offline"));

    expect(await getWorkspaceAgentTools()).toEqual([]);
    expect((await getWorkspaceAgentTools()).map((t) => t.tool_name)).toEqual([
      "get_widget_data",
      "read_widget",
    ]);
    expect(getWorkspaceTools).toHaveBeenCalledTimes(2);
  });
});

describe("the tools of the agent request", () => {
  const grants = (mcp: CopilotAccess["mcp"]): CopilotAccess => ({
    models: [],
    mcp,
  });

  it("have the FINOS Workspace's tools after those of the servers the user connected", async () => {
    useMcpToolsStore.setState({
      servers: [
        {
          id: "docs",
          name: "docs",
          url: "https://docs.example.com/mcp",
          enabled: true,
          toolsEnabled: true,
          tools: [{ id: "search", name: "search", enabled: true }],
        },
      ],
      mcpConnectionRegistry: { docs: { state: "ready", retry: () => {} } as never },
    });
    useCopilotAccessStore.getState().setAccess(
      grants([
        { server_url: "https://docs.example.com/mcp", tool_name: "*" },
        { server_url: URL, tool_name: "*" },
      ]),
    );

    const tools = await useMcpToolsStore.getState().getEnabledToolsForAgent();

    expect(tools.map((t) => `${t.server_id}:${t.tool_name}`)).toEqual([
      "docs:search",
      "workspace:get_widget_data",
      "workspace:read_widget",
    ]);
  });

  it("have the FINOS Workspace's tools for a user who connected no server", async () => {
    useCopilotAccessStore
      .getState()
      .setAccess(grants([{ server_url: URL, tool_name: "*" }]));
    const tools = await useMcpToolsStore.getState().getEnabledToolsForAgent();
    expect(tools.map((t) => t.name)).toEqual([
      "Workspace_get_widget_data",
      "Workspace_read_widget",
    ]);
  });

  it("have none of them for a user whose roles grant nothing", async () => {
    useCopilotAccessStore.getState().setAccess(grants([]));
    expect(await useMcpToolsStore.getState().getEnabledToolsForAgent()).toEqual([]);
  });

  it("have only the FINOS Workspace's tools that the user's roles grant", async () => {
    useCopilotAccessStore
      .getState()
      .setAccess(grants([{ server_url: URL, tool_name: "read_widget" }]));

    const tools = await useMcpToolsStore.getState().getEnabledToolsForAgent();

    expect(tools.map((t) => t.tool_name)).toEqual(["read_widget"]);
  });

  it("have none of them when the roles grant only the tools of another server", async () => {
    useCopilotAccessStore
      .getState()
      .setAccess(
        grants([{ server_url: "https://docs.example.com/mcp", tool_name: "*" }]),
      );

    expect(await useMcpToolsStore.getState().getEnabledToolsForAgent()).toEqual([]);
  });
});
