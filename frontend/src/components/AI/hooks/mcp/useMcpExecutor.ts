import { useCallback } from "react";
import { toast } from "sonner";
import { getIframeWidget } from "~/lib/iframeWidgetRegistry";
import type { CopilotDataT } from "~/lib/state/copilot";
import { CopilotErrorType } from "~/lib/state/copilot";
import { type McpServer, useShallowMcpToolsStore } from "~/lib/state/mcpTools";
import { citeMcpCall } from "~/lib/utils/mcpLink";
import { toError } from "~/lib/utils/utils";
import { getAllWidgets } from "~/lib/utils/widget";

type ExecuteAgentTool = (
  serverId: string,
  toolName: string,
  parameters?: Record<string, unknown>,
) => Promise<CopilotDataT[]>;

interface WidgetCitation {
  widgetId: string;
  source: string;
  name?: string;
  description?: string;
  inputArgs: Record<string, unknown>;
  details: Record<string, unknown>;
}

interface IframeMcpCitation {
  widgetId: string;
  widgetName: string;
  serverId: string;
  serverName: string;
  toolName: string;
  toolDescription?: string;
  iframeParams?: Record<string, string>;
}

function findEquivalentWidget(
  server: McpServer,
  toolName: string,
  callArgs: Record<string, unknown>,
): WidgetCitation | null {
  const citation = citeMcpCall(
    server,
    toolName,
    callArgs,
    getAllWidgets(undefined, ["backend"]),
  );
  if (!citation) return null;
  const { widget, inputArgs, details } = citation;
  return {
    widgetId: widget.widgetId || "",
    source:
      widget.sourceName ||
      (Array.isArray(widget.source) ? widget.source.join(", ") : widget.source || ""),
    name: widget.name,
    description: widget.description,
    inputArgs,
    details,
  };
}

function getErrorContent(
  toolName: string,
  _serverName: string,
  error: Error,
): CopilotDataT {
  const errorContent = {
    error_type: CopilotErrorType.UNEXPECTED,
    content: `Error executing MCP tool "${toolName}": ${error.message}

${error.message}`,
  };

  return {
    items: [
      {
        content: JSON.stringify(errorContent, null, 2),
      },
    ],
  };
}

export function useMcpExecutor() {
  const mcpToolsStore = useShallowMcpToolsStore((state) => ({
    getServerById: state.getServerById,
    getMCPConnection: state.getMCPConnection,
  }));

  const executeAgentTool = useCallback<ExecuteAgentTool>(
    async (serverId, toolName, parameters) => {
      const [serverName, ...toolNameParts] = toolName.split("_");
      const actualToolName = toolNameParts.join("_");

      if (!(serverId && actualToolName))
        throw new Error(`Invalid tool name format: ${toolName}`);

      const { getServerById, getMCPConnection } = mcpToolsStore;
      const mcpConnection = getMCPConnection(serverId);
      const server = getServerById(serverId);

      try {
        if (!server) throw new Error(`Server not found: ${serverName}`);

        if (!server.enabled) {
          throw new Error(
            `Server ${server.name} is disconnected. Connect it in the MCP Servers settings.`,
          );
        }

        if (!server.toolsEnabled) {
          throw new Error(
            `Server ${server.name} tools are disabled. Enable them in the MCP Tools dialog to use its tools.`,
          );
        }

        if (!server.connected) {
          throw new Error(
            `Server ${server.name} is not connected. Check connection in MCP Servers settings.`,
          );
        }

        if (!mcpConnection?.callTool) {
          throw new Error(`No active MCP connection found for server ${server.name}.`);
        }

        if (mcpConnection.state !== "ready") {
          throw new Error(
            `MCP connection for server \`${server.name}\` is not ready (state: ${mcpConnection.state})`,
          );
        }

        const calledTool = server.tools.find((t) => t.id === actualToolName);
        if (calledTool && !calledTool.enabled) {
          throw new Error(
            `Tool ${actualToolName} is disabled. Enable it in the MCP Tools dialog to use it.`,
          );
        }

        let retryCount = 0;
        const maxRetries = 3;
        let result: unknown;

        while (retryCount < maxRetries) {
          try {
            const safeParameters = parameters || {};
            result = await mcpConnection.callTool(actualToolName, safeParameters);
            break;
          } catch (error) {
            if (
              toError(error).message.includes("not ready") &&
              retryCount < maxRetries - 1
            ) {
              retryCount++;
              await new Promise((resolve) => setTimeout(resolve, 500));

              const refreshedConnection = getMCPConnection(serverId);
              if (
                refreshedConnection?.callTool &&
                refreshedConnection.state === "ready"
              ) {
                mcpConnection.callTool = refreshedConnection.callTool;
                mcpConnection.state = refreshedConnection.state;
              }
            } else {
              throw error;
            }
          }
        }

        if (server.iframeWidgetId) {
          if (calledTool?.annotations?.destructiveHint === true) {
            getIframeWidget(server.iframeWidgetId)?.sendRefresh();
          }
        }

        const getContent = (result: unknown): unknown => {
          if (result && typeof result === "object") {
            const isMcpErrorResult = "isError" in result && result.isError === true;
            if (isMcpErrorResult) return result;

            if (
              "structuredContent" in result &&
              typeof (result.structuredContent as { results?: unknown } | null)
                ?.results === "object"
            )
              return result.structuredContent;

            if ("content" in result && typeof result.content === "object") {
              const handleItem = (item: unknown): unknown => {
                if (item === null || item === undefined) return item;
                if (Array.isArray(item)) return item.map(handleItem);
                if (typeof item === "object" && "text" in item) return item.text;
                return item;
              };
              return handleItem(result.content);
            }
          }

          return result;
        };

        const rawContent = getContent(result);
        const content =
          typeof rawContent === "string"
            ? rawContent
            : JSON.stringify(rawContent, null, 2);

        const equivalentWidget = server.iframeWidgetId
          ? null
          : findEquivalentWidget(server, actualToolName, parameters ?? {});
        if (equivalentWidget) {
          const widgetName = equivalentWidget.name || equivalentWidget.widgetId;
          toast.info("Matching widget found", {
            description: `The call to ${actualToolName} is cited as the widget ${widgetName}`,
          });
        }

        const toTitleCase = (s: string) =>
          s.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

        const buildExtraCitations = (
          match: WidgetCitation | null,
          params?: Record<string, unknown>,
          iframeCitation?: IframeMcpCitation | null,
        ) => {
          const entries = Object.entries(params || {}).filter(
            ([, v]) => v !== null && v !== undefined,
          );
          const detailsObj = Object.fromEntries(
            entries.map(([k, v]) => [toTitleCase(k), v]),
          );

          if (iframeCitation) {
            const iframeInputArgs = iframeCitation.iframeParams || {};
            return [
              {
                source_info: {
                  type: "widget",
                  name: iframeCitation.widgetName || iframeCitation.serverName,
                  origin: "Workspace",
                  uuid: iframeCitation.widgetId,
                  widget_id: iframeCitation.widgetId,
                  description:
                    iframeCitation.toolDescription ||
                    `MCP tool ${iframeCitation.toolName} from ${iframeCitation.serverName}`,
                  citable: true,
                  metadata: {
                    iframe_mcp: true,
                    matching: true,
                    server_id: iframeCitation.serverId,
                    server_name: iframeCitation.serverName,
                    tool_name: iframeCitation.toolName,
                    widget_uuid: iframeCitation.widgetId,
                    input_args: iframeInputArgs,
                    mcp_tool_args: params || {},
                  },
                },
                details: entries.length > 0 ? [detailsObj] : [],
              },
            ];
          }

          if (!match) return [];
          const unmapped = Object.entries(match.details).filter(
            ([, v]) => v !== null && v !== undefined,
          );
          const details =
            unmapped.length > 0
              ? [Object.fromEntries(unmapped.map(([k, v]) => [toTitleCase(k), v]))]
              : [];
          return [
            {
              source_info: {
                type: "widget",
                name: match.name || match.widgetId,
                origin: match.source,
                widget_id: match.widgetId,
                description: match.description,
                citable: true,
                metadata: {
                  matching: true,
                  input_args: match.inputArgs,
                },
              },
              details,
            },
          ];
        };

        const extraCitations = buildExtraCitations(
          equivalentWidget,
          parameters as Record<string, unknown>,
          server.iframeWidgetId
            ? {
                widgetId: server.iframeWidgetId,
                widgetName: server.name,
                serverId,
                serverName: server.clientName || server.name,
                toolName: actualToolName,
                toolDescription: calledTool?.description,
                iframeParams: server.iframeParams,
              }
            : null,
        );

        return [{ items: [{ content }], extra_citations: extraCitations }];
      } catch (error) {
        console.error(`[MCP Executor] Tool execution failed for ${toolName}:`, error);

        return [getErrorContent(toolName, server?.name || serverId, toError(error))];
      }
    },
    [mcpToolsStore],
  );

  return executeAgentTool;
}
