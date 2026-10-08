import { createWithEqualityFn } from "zustand/traditional";

export type CopilotModelGrant = { agent_id: string; model_id: string };

export type McpGrant = { server_url: string; tool_name: string };

/** What the user may use in the Copilot, as the roles an admin assigned them grant. */
export type CopilotAccess = {
  models: CopilotModelGrant[];
  mcp: McpGrant[];
  models_restricted: boolean;
  mcp_restricted: boolean;
};

export const ALL_MCP_TOOLS = "*";

/** The form in which the backend stores and compares MCP server URLs. */
export function normalizeMcpUrl(url: string): string {
  const match = /^([^:/?#]+):\/\/([^/?#]*)([^?#]*)/.exec(url.trim());
  if (!match) return url.trim();
  const [, scheme, host, path] = match;
  return `${scheme.toLowerCase()}://${host.toLowerCase()}${path.replace(/\/+$/, "")}`;
}

export function isModelAllowed(
  access: CopilotAccess | null | undefined,
  agentId: string,
  modelId: string,
): boolean {
  if (!access?.models_restricted) return true;
  return access.models.some((g) => g.agent_id === agentId && g.model_id === modelId);
}

export function isMcpToolAllowed(
  access: CopilotAccess | null | undefined,
  serverUrl: string,
  toolName: string,
): boolean {
  if (!access?.mcp_restricted) return true;
  const url = normalizeMcpUrl(serverUrl);
  return access.mcp.some(
    (g) =>
      g.server_url === url &&
      (g.tool_name === ALL_MCP_TOOLS || g.tool_name === toolName),
  );
}

/** The models of an agent that the user may use. */
export function allowedModels<T extends { id: string }>(
  access: CopilotAccess | null | undefined,
  agentId: string,
  models: T[] | undefined,
): T[] {
  return (models ?? []).filter((m) => isModelAllowed(access, agentId, m.id));
}

/**
 * The model a request uses: the user's choice when they may use it, else the first model
 * they may use. When they may use none, the first model, which the service then refuses.
 */
export function selectModelId(
  access: CopilotAccess | null | undefined,
  agentId: string,
  models: { id: string }[] | undefined,
  storedModelId: string | undefined,
): string | undefined {
  const allowed = allowedModels(access, agentId, models);
  if (storedModelId && allowed.some((m) => m.id === storedModelId)) {
    return storedModelId;
  }
  return allowed[0]?.id ?? models?.[0]?.id;
}

interface CopilotAccessState {
  access: CopilotAccess | null;
  setAccess: (access: CopilotAccess | null | undefined) => void;
}

export const useCopilotAccessStore = createWithEqualityFn<CopilotAccessState>()(
  (set) => ({
    access: null,
    setAccess: (access) => set({ access: access ?? null }),
  }),
);

export const getCopilotAccess = () => useCopilotAccessStore.getState().access;
