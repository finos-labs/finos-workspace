import { apiClient } from "~/api/api";
import type { McpInputSchema } from "~/lib/state/mcpTools";

/** One of the FINOS Workspace's tools, as the FINOS Workspace describes it to the agent. */
export interface WorkspaceToolDefinition {
  name: string;
  description?: string | null;
  inputSchema: McpInputSchema;
}

export interface WorkspaceToolsResponse {
  /** The address of the server of the tools, which is what the user's roles grant them by. */
  url: string;
  tools: WorkspaceToolDefinition[];
}

/** What a call of a tool comes to: the command that this tab runs, or the answer when there is none to run. */
export interface PreparedWorkspaceToolCall {
  command: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}

export async function getWorkspaceTools(): Promise<WorkspaceToolsResponse> {
  const resp = await apiClient.get<WorkspaceToolsResponse>("/app/workspace-tools");
  return resp.data;
}

export async function prepareWorkspaceToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<PreparedWorkspaceToolCall> {
  const resp = await apiClient.post<PreparedWorkspaceToolCall>(
    "/app/workspace-tools/prepare",
    { name, arguments: args },
  );
  return resp.data;
}
