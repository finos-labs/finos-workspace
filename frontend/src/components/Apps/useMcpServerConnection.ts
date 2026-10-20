import { useCallback } from "react";
import { useShallowMcpToolsStore } from "~/lib/state/mcpTools";
import type { AppMcpServer } from "~/types/appMcpServer";

interface McpServerIdentity {
  /** Custom backend source id */
  sourceId?: string;
}

/**
 * Shared store wiring for a single MCP server declared by a backend. Both the
 * MCP hover popover and the app details modal read connection state and save
 * tokens through here so the logic lives in one place. A token is write-only: the
 * API keeps it encrypted and only says whether one is saved.
 */
export function useMcpServerConnection(
  mcpServer: AppMcpServer | undefined,
  identity: McpServerIdentity,
) {
  const { sourceId } = identity;

  const {
    existingServer,
    connectionState,
    connectionError,
    toolCount,
    addServer,
    updateServer,
  } = useShallowMcpToolsStore((s) => {
    const server = s.servers.find((x) => sourceId && x.sourceId === sourceId);
    const conn = server ? s.getMCPConnection(server.id) : undefined;
    return {
      existingServer: server,
      connectionState: conn?.state ?? "disconnected",
      connectionError: conn?.error,
      toolCount: conn?.tools?.length ?? 0,
      addServer: s.addServer,
      updateServer: s.updateServer,
    };
  });

  const connect = useCallback(() => {
    if (!mcpServer) return;
    addServer({
      id: Date.now().toString(),
      name: mcpServer.name,
      url: mcpServer.url,
      enabled: true,
      autoReconnect: true,
      tools: [],
      sourceId,
    });
  }, [addServer, mcpServer, sourceId]);

  const saveToken = useCallback(
    (token: string) => {
      if (!mcpServer) return;
      const customHeaders = { Authorization: `Bearer ${token}` };
      if (existingServer) {
        // Auto-registration leaves token-auth servers disabled until a token
        // exists, so saving one is what actually brings the server online. A
        // connected server reconnects with the new token once it is saved.
        updateServer(
          existingServer.id,
          { customHeaders, authType: "token", enabled: true },
          true,
        );
        return;
      }
      addServer({
        id: Date.now().toString(),
        name: mcpServer.name,
        url: mcpServer.url,
        enabled: true,
        autoReconnect: true,
        tools: [],
        sourceId,
        customHeaders,
        authType: "token",
      });
    },
    [existingServer, updateServer, addServer, mcpServer, sourceId],
  );

  // Without its token a token-auth server cannot connect, so it is turned off too
  const removeToken = useCallback(() => {
    if (!existingServer) return;
    updateServer(existingServer.id, {
      customHeaders: { Authorization: null },
      enabled: false,
    });
  }, [existingServer, updateServer]);

  return {
    existingServer,
    connectionState,
    connectionError,
    toolCount,
    hasToken: !!existingServer?.hasToken,
    isConnected: connectionState === "ready",
    isFailed: connectionState === "failed",
    connect,
    saveToken,
    removeToken,
  };
}
