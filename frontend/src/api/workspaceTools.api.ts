import { apiClient } from "~/api/api";
import type { McpInputSchema } from "~/lib/state/mcpTools";

export interface WorkspaceToolDefinition {
  name: string;
  description?: string | null;
  inputSchema: McpInputSchema;
}

export interface WorkspaceToolsResponse {
  url: string;
  tools: WorkspaceToolDefinition[];
}

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
