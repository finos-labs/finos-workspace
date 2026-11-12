import Fuse from "fuse.js";
import { useCallback, useMemo } from "react";
import { isMcpToolAllowed, useCopilotAccessStore } from "~/lib/state/copilotAccess";
import {
  dedupeIframeServersByUrl,
  modelMayCallTool,
  useShallowMcpToolsStore,
} from "~/lib/state/mcpTools";

export const MCP_TOOL_TRIGGER = "/";

export interface McpToolSuggestion {
  type: "mcpTool";
  id: string;
  serverName: string;
  serverUrl: string;
  toolName: string;
  toolId: string;
  description: string;
  slashText: string;
  inputSchema?: unknown;
}

export function useMcpToolSuggestions() {
  const { servers, getMCPConnection, connSignature } = useShallowMcpToolsStore((s) => ({
    servers: s.servers,
    getMCPConnection: s.getMCPConnection,
    connSignature: s.servers
      .map((srv) => `${srv.id}:${s.getMCPConnection(srv.id)?.state ?? ""}`)
      .join("|"),
  }));

  const access = useCopilotAccessStore((s) => s.access);

  const mcpToolOptions = useMemo((): McpToolSuggestion[] => {
    const tools: McpToolSuggestion[] = [];

    const connectedServers = dedupeIframeServersByUrl(
      servers.filter((server) => {
        const connection = getMCPConnection(server.id);
        return connection?.state === "ready" && server.enabled;
      }),
    );

    for (const server of connectedServers) {
      if (!server.toolsEnabled) continue;

      for (const tool of server.tools) {
        if (
          tool.enabled &&
          modelMayCallTool(tool) &&
          isMcpToolAllowed(access, server.url, tool.id)
        ) {
          tools.push({
            type: "mcpTool",
            id: `${server.id}_${tool.id}`,
            serverName: server.name,
            serverUrl: server.url,
            toolName: tool.name,
            toolId: tool.id,
            description: tool.description || "",
            inputSchema: tool.inputSchema,
            slashText: `/${server.name}_${tool.name}`
              .replace(/ /g, "\u00A0")
              .replace(/-/g, "\u2011"),
          });
        }
      }
    }

    return tools;
  }, [servers, getMCPConnection, connSignature, access]);

  const fuse = useMemo(
    () =>
      new Fuse(mcpToolOptions, {
        keys: ["serverName", "toolName", "toolId", "description"],
        threshold: 0.3,
      }),
    [mcpToolOptions],
  );

  const searchMcpTools = useCallback(
    (query: string): McpToolSuggestion[] => {
      const searchTerm = query.startsWith(MCP_TOOL_TRIGGER)
        ? query.slice(MCP_TOOL_TRIGGER.length)
        : query;

      if (!searchTerm) return mcpToolOptions;

      return fuse
        .search(searchTerm)
        .filter((result) => query.length <= result.item.slashText.length)
        .map((result) => result.item);
    },
    [mcpToolOptions, fuse],
  );

  return {
    mcpToolOptions,
    searchMcpTools,
    hasMcpTools: mcpToolOptions.length > 0,
  };
}
