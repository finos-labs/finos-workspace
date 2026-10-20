import { memo, useEffect, useMemo } from "react";
import { type McpServer, useShallowMcpToolsStore } from "~/lib/state/mcpTools";
import { type UseMcpOptionsT, useMcp } from "./hooks/mcp/useMcp";

type McpConnectionServer = Pick<
  McpServer,
  "enabled" | "url" | "clientName" | "autoReconnect" | "isLocal" | "authType" | "id"
> & { serverName: string };

// Individual connection component that persists outside the modal
const McpConnection = memo(({ serverId }: { serverId: string }) => {
  const server = useShallowMcpToolsStore((s): McpConnectionServer | null => {
    const server = s.getServerById(serverId);
    if (!server) return null;

    return {
      serverName: server.name || "Unknown MCP Server",
      enabled: server.enabled,
      url: server.url,
      clientName: server.clientName,
      autoReconnect: server.autoReconnect,
      isLocal: server.isLocal,
      authType: server.authType,
      id: server.id,
    };
  });

  return server ? <McpServerConnection server={server} /> : null;
});

const McpServerConnection = memo(({ server }: { server: McpConnectionServer }) => {
  const { addToolsToServer, updateMCPConnectionRegistry, updateServer } =
    useShallowMcpToolsStore((s) => ({
      addToolsToServer: s.addToolsToServer,
      updateMCPConnectionRegistry: s.updateMCPConnectionRegistry,
      updateServer: s.updateServer,
    }));

  const mcpConfig = useMemo<UseMcpOptionsT>(() => {
    return {
      url: server.url,
      serverId: server.id,
      clientName: server.clientName || "Workspace",
      serverName: server.serverName,
      autoReconnect: server.autoReconnect ?? true,
      isLocal: server.isLocal ?? false,
      authType: server.authType,
      handleDisconnect: () => {
        // Update server state to trigger disconnection in connection manager
        updateServer(server.id, { enabled: false });
      },
    };
  }, [server]);

  const { state, error, tools, callTool, retry, disconnect, clearStorage } =
    useMcp(mcpConfig);

  // Register connection in global registry when ready
  useEffect(() => {
    updateMCPConnectionRegistry(server.id, {
      callTool,
      state,
      tools,
      error,
      disconnect,
      clearStorage,
      retry,
    });
  }, [state, tools, error]);

  useEffect(() => {
    // Auto-save discovered tools to store
    if (tools?.length > 0 && state === "ready") {
      const mcpTools = tools.map((tool) => ({
        id: tool.name,
        name: tool.name,
        description: tool.description,
        enabled: true, // Default to enabled so all tools are pre-selected
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      }));

      addToolsToServer(server.id, mcpTools);
    }
  }, [tools?.length, state]);

  return null; // This component doesn't render anything
});

// Main connection manager that handles all servers
export const McpConnectionManager = memo(() => {
  const serverIds = useShallowMcpToolsStore((state) =>
    state.servers.filter((s) => s.enabled).map((s) => s.id),
  );
  return useMemo(() => {
    return (
      <>
        {serverIds.map((serverId) => (
          <McpConnection key={serverId} serverId={serverId} />
        ))}
      </>
    );
  }, [serverIds]);
});
