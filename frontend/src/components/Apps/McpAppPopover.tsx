import { memo, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "~/components/ds/atoms/Button";
import Icon from "~/components/Icon";
import { canAddConnections, useShallowAccessStore } from "~/lib/state/access";
import { type AppMcpServer, mcpServerUsesTokenAuth } from "~/types/appMcpServer";
import { McpTokenModal } from "./McpTokenModal";
import { useMcpServerConnection } from "./useMcpServerConnection";

interface McpAppPopoverProps {
  sourceId?: string;
  mcpServer: AppMcpServer;
  isSubscribed: boolean;
  tokenActionExternal?: boolean;
}

export const McpAppPopover = memo((props: McpAppPopoverProps) => {
  const { sourceId, mcpServer, isSubscribed } = props;
  const tokenActionExternal = props.tokenActionExternal ?? false;
  const navigate = useNavigate();
  const mayAdd = useShallowAccessStore((s) => canAddConnections(s.access));
  const displayName = mcpServer.name;
  const isTokenAuth = mcpServerUsesTokenAuth(mcpServer);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);

  const {
    existingServer,
    connectionError,
    toolCount,
    hasToken,
    isConnected,
    isFailed,
    connect: handleAdd,
    saveToken: handleTokenSave,
    removeToken: handleTokenRemove,
  } = useMcpServerConnection(mcpServer, { sourceId });

  const openTokenModal = useCallback(() => setTokenModalOpen(true), []);

  const handleManage = useCallback(() => {
    const search = new URLSearchParams({ tab: "mcp-servers" });
    if (existingServer?.id) search.set("serverId", existingServer.id);
    navigate(`/app/ai?${search.toString()}`);
  }, [navigate, existingServer?.id]);

  const { title, description, action } = useMemo(() => {
    if (isTokenAuth) {
      const tokenLabel = hasToken ? "Replace token" : "Add token";
      const tokenButton = tokenActionExternal ? null : (
        <Button variant="ghost" size="xs" onClick={openTokenModal}>
          {tokenLabel}
        </Button>
      );

      if (!existingServer) {
        if (!isSubscribed) {
          return {
            title: `${displayName} MCP server`,
            description:
              mcpServer.description || `Connect ${displayName} to add MCP access.`,
            action: (
              <Button variant="secondary" size="xs" disabled={true}>
                Connect app first
              </Button>
            ),
          };
        }
        return {
          title: `${displayName} MCP server`,
          description:
            mcpServer.description || `Add ${mcpServer.name} to enable tools.`,
          action:
            tokenActionExternal || !mayAdd ? null : (
              <Button variant="primary" size="xs" onClick={openTokenModal}>
                Add MCP Server
              </Button>
            ),
        };
      }

      if (isFailed) {
        return {
          title: `${displayName} MCP server`,
          description:
            connectionError ||
            `Couldn't connect to ${mcpServer.name}. Check that your token is valid and not expired.`,
          action: tokenActionExternal ? null : (
            <Button variant="primary" size="xs" onClick={openTokenModal}>
              {tokenLabel}
            </Button>
          ),
        };
      }

      if (isConnected) {
        return {
          title: `${displayName} MCP added`,
          description:
            mcpServer.description ||
            `Agent has access to ${toolCount} ${displayName} tool${toolCount === 1 ? "" : "s"}.`,
          action: (
            <div className="flex items-center gap-1.5">
              {tokenButton}
              <Button variant="secondary" size="xs" onClick={handleManage}>
                Manage MCP Server
              </Button>
            </div>
          ),
        };
      }

      return {
        title: `${displayName} MCP server`,
        description: mcpServer.description || `Connect to ${mcpServer.name}.`,
        action: (
          <div className="flex items-center gap-1.5">
            {tokenButton}
            <Button variant="secondary" size="xs" onClick={handleManage}>
              Manage MCP Server
            </Button>
          </div>
        ),
      };
    }

    if (existingServer && isConnected) {
      return {
        title: `${displayName} MCP added`,
        description:
          mcpServer.description ||
          `Agent has access to ${toolCount} ${displayName} tool${toolCount === 1 ? "" : "s"}.`,
        action: (
          <Button variant="secondary" size="xs" onClick={handleManage}>
            Manage MCP Server
          </Button>
        ),
      };
    }

    if (existingServer) {
      return {
        title: `${displayName} MCP server`,
        description: mcpServer.description || `Connect to ${mcpServer.name}.`,
        action: (
          <Button variant="secondary" size="xs" onClick={handleManage}>
            Manage MCP Server
          </Button>
        ),
      };
    }

    if (!isSubscribed) {
      return {
        title: `${displayName} MCP server`,
        description:
          mcpServer.description || `Connect ${displayName} to add MCP access.`,
        action: (
          <Button variant="secondary" size="xs" disabled={true}>
            Connect app first
          </Button>
        ),
      };
    }

    return {
      title: `${displayName} MCP server`,
      description: mcpServer.description || `Add ${mcpServer.name} to enable tools.`,
      action: mayAdd ? (
        <Button variant="primary" size="xs" onClick={handleAdd}>
          Add MCP Server
        </Button>
      ) : null,
    };
  }, [
    isTokenAuth,
    hasToken,
    connectionError,
    existingServer,
    isConnected,
    isFailed,
    isSubscribed,
    tokenActionExternal,
    mayAdd,
    displayName,
    mcpServer.description,
    mcpServer.name,
    toolCount,
    handleAdd,
    handleManage,
    openTokenModal,
  ]);

  return (
    <div
      className="flex flex-col gap-2 min-w-[240px] max-w-[300px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        <Icon id="mcp" className="w-3.5 h-3.5 text-ds-text-body" />
        <p className="text-xs font-semibold text-ds-text-heading">{title}</p>
      </div>
      <p className="text-xs text-ds-text-body leading-[18px]">{description}</p>
      {action && <div className="flex justify-end">{action}</div>}
      {isTokenAuth && !tokenActionExternal && (
        <McpTokenModal
          isOpen={tokenModalOpen}
          onClose={() => setTokenModalOpen(false)}
          serverName={mcpServer.name}
          hasSavedToken={hasToken}
          onSave={handleTokenSave}
          onRemove={handleTokenRemove}
          error={isFailed ? connectionError : undefined}
        />
      )}
    </div>
  );
});

McpAppPopover.displayName = "McpAppPopover";
