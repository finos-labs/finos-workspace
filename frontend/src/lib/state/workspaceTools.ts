import { getWorkspaceTools } from "~/api/workspaceTools.api";
import { useAuthStore } from "./auth";
import type { AgentToolConfig } from "./mcpTools";

export const WORKSPACE_SERVER_ID = "workspace";
const WORKSPACE_SERVER_NAME = "Workspace";

const NAME_PREFIX = `${WORKSPACE_SERVER_NAME}_`;

export function workspaceToolName(agentToolName: string): string {
  return agentToolName.startsWith(NAME_PREFIX)
    ? agentToolName.slice(NAME_PREFIX.length)
    : agentToolName;
}

let cached: { userUuid: string; tools: Promise<AgentToolConfig[]> } | null = null;

export function getWorkspaceAgentTools(): Promise<AgentToolConfig[]> {
  const userUuid = useAuthStore.getState().user?.uuid;
  if (!userUuid) return Promise.resolve([]);
  if (cached?.userUuid === userUuid) return cached.tools;

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
      console.warn(
        "[FINOS Workspace tools] Could not load the FINOS Workspace's tools",
        error,
      );
      if (cached?.userUuid === userUuid) cached = null;
      return [];
    });
  cached = { userUuid, tools };
  return tools;
}

export function resetWorkspaceAgentTools(): void {
  cached = null;
}
