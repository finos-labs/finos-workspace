import { createWithEqualityFn } from "zustand/traditional";

export type CopilotModelGrant = { agent_id: string; model_id: string };

export type McpGrant = { server_url: string; tool_name: string };

/**
 * What a role can switch off: the Copilot's tools for the web. The names are the backend's, and so
 * are the tools each stands for (`CAPABILITY_MCP_TOOLS` in api/schemas.py).
 */
export type CopilotCapability = "SEARCH_WEB" | "FETCH_FROM_WEB";

export const CAPABILITY_MCP_TOOLS: Record<CopilotCapability, readonly string[]> = {
  SEARCH_WEB: ["web_search"],
  FETCH_FROM_WEB: ["fetch_webpage", "inspect_webpage"],
};

/** What the user may use in the Copilot: only what the roles an admin assigned them grant, less the
 * web tools none of those roles allows. */
export type CopilotAccess = {
  models: CopilotModelGrant[];
  mcp: McpGrant[];
  /** The web tools none of the user's roles allows: they are not theirs whatever else is granted. */
  disabled_capabilities?: CopilotCapability[];
};

export const ALL_MCP_TOOLS = "*";

/** The form in which the backend stores and compares MCP server URLs. */
export function normalizeMcpUrl(url: string): string {
  const match = /^([^:/?#]+):\/\/([^/?#]*)([^?#]*)/.exec(url.trim());
  if (!match) return url.trim();
  const [, scheme, host, path] = match;
  return `${scheme.toLowerCase()}://${host.toLowerCase()}${path.replace(/\/+$/, "")}`;
}

/**
 * The id an agent's model grants are filed under: the id the agent gives itself in its
 * agents.json, which it names when it asks the API whether the user may use a model. The
 * web app knows the default agent, "default_agent" in agents.json, as "default-copilot".
 */
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
    access?.models.some((g) => g.agent_id === grantId && g.model_id === modelId) ??
    false
  );
}

/** Whether the tool is one of those that an administrator switched off for the user, on whichever server. */
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
  // Switched off beats what the roles grant, and goes by the tool's name: the same server under another
  // address is the same tool.
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
