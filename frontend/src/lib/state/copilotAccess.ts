import { createWithEqualityFn } from "zustand/traditional";

export type CopilotModelGrant = { agent_id: string; model_id: string };

export type McpGrant = { server_url: string; tool_name: string };

export type CopilotCapability = "SEARCH_WEB" | "FETCH_FROM_WEB";

export const CAPABILITY_MCP_TOOLS: Record<CopilotCapability, readonly string[]> = {
  SEARCH_WEB: ["web_search"],
  FETCH_FROM_WEB: ["fetch_webpage", "inspect_webpage"],
};

export type CopilotAccess = {
  models: CopilotModelGrant[];
  mcp: McpGrant[];
  disabled_capabilities?: CopilotCapability[];
};

export const ALL_MCP_TOOLS = "*";
export const ALL_MODELS = "*";

export function normalizeMcpUrl(url: string): string {
  const match = /^([^:/?#]+):\/\/([^/?#]*)([^?#]*)/.exec(url.trim());
  if (!match) return url.trim();
  const [, scheme, host, path] = match;
  return `${scheme.toLowerCase()}://${host.toLowerCase()}${path.replace(/\/+$/, "")}`;
}

export function grantAgentId(agentId: string): string {
  return agentId === "default-copilot" ? "default_agent" : agentId;
}

export function isModelAllowed(
  access: CopilotAccess | null | undefined,
  agentId: string,
  modelId: string,
): boolean {
  const grantId = grantAgentId(agentId);
  return (
    access?.models.some(
      (g) =>
        g.agent_id === grantId && (g.model_id === modelId || g.model_id === ALL_MODELS),
    ) ?? false
  );
}

export function isAgentGranted(
  access: CopilotAccess | null | undefined,
  agentId: string,
): boolean {
  const grantId = grantAgentId(agentId);
  return access?.models.some((g) => g.agent_id === grantId) ?? false;
}

export function isMcpToolSwitchedOff(
  access: CopilotAccess | null | undefined,
  toolName: string,
): boolean {
  return (access?.disabled_capabilities ?? []).some((capability) =>
    CAPABILITY_MCP_TOOLS[capability]?.includes(toolName),
  );
}

export function isMcpToolAllowed(
  access: CopilotAccess | null | undefined,
  serverUrl: string,
  toolName: string,
): boolean {
  if (isMcpToolSwitchedOff(access, toolName)) return false;
  const url = normalizeMcpUrl(serverUrl);
  return (
    access?.mcp.some(
      (g) =>
        g.server_url === url &&
        (g.tool_name === ALL_MCP_TOOLS || g.tool_name === toolName),
    ) ?? false
  );
}

export function allowedModels<T extends { id: string }>(
  access: CopilotAccess | null | undefined,
  agentId: string,
  models: T[] | undefined,
): T[] {
  return (models ?? []).filter((m) => isModelAllowed(access, agentId, m.id));
}

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
