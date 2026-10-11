import { getWorkspaceTools } from "~/api/workspaceTools.api";
import { useAuthStore } from "./auth";
import type { AgentToolConfig } from "./mcpTools";

/**
 * The Workspace's own tools, which the agent in the app is given with the tools of the MCP servers
 * that the user connected. They are described by the Workspace (the backend serves the same tools,
 * with the same descriptions and schemas, to external hosts over MCP) and this tab runs them when
 * the agent calls one, so there is no server to connect to and no token to hand over: the user is
 * signed in, and the tab is theirs.
 */
export const WORKSPACE_SERVER_ID = "workspace";
/** What the tools' names start with, as the tools of every server do (`<server name>_<tool>`). */
export const WORKSPACE_SERVER_NAME = "Workspace";

const NAME_PREFIX = `${WORKSPACE_SERVER_NAME}_`;

/** The name a Workspace tool has on the Workspace's server: the name the agent calls it by, without the server's. */
export function workspaceToolName(agentToolName: string): string {
  return agentToolName.startsWith(NAME_PREFIX)
    ? agentToolName.slice(NAME_PREFIX.length)
    : agentToolName;
}

let cached: { token: string; tools: Promise<AgentToolConfig[]> } | null = null;

/**
 * The Workspace's tools that the user's roles grant, as tools of an agent request. They are asked for
 * once for each signed-in session; when they cannot be had the agent goes without them, and the
 * next request asks again.
 */
export function getWorkspaceAgentTools(): Promise<AgentToolConfig[]> {
  const token = useAuthStore.getState().user?.token;
  if (!token) return Promise.resolve([]);
  if (cached?.token === token) return cached.tools;

  const tools = getWorkspaceTools()
    .then(({ url, tools }) =>
      tools.map<AgentToolConfig>((tool) => ({
        server_id: WORKSPACE_SERVER_ID,
        name: `${NAME_PREFIX}${tool.name}`,
        tool_name: tool.name,
        description: tool.description ?? undefined,
        url,
        input_schema: tool.inputSchema,
      })),
    )
    .catch((error: unknown) => {
      console.warn("[Workspace tools] Could not load the Workspace's tools", error);
      if (cached?.token === token) cached = null;
      return [];
    });
  cached = { token, tools };
  return tools;
}

/** Forgets the tools, so that the next request asks again (for a user who signs out, or whose roles changed). */
export function resetWorkspaceAgentTools(): void {
  cached = null;
}
