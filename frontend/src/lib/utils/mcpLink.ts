import type { WidgetT } from "~/components/types";
import type { AgentToolConfig, McpServer } from "~/lib/state/mcpTools";
import type { McpToolContractT } from "~/lib/types/widgetsContract";

type LinkedWidget = Pick<WidgetT, "sourceId"> & { mcp_tool?: McpToolContractT };

export interface ActiveMcpLink {
  server_id: string;
  tool_name: string;
  args?: McpToolContractT["args"];
}

function linkedServer(
  widget: LinkedWidget | undefined,
  servers: McpServer[],
): McpServer | undefined {
  const link = widget?.mcp_tool;
  if (!(link && widget?.sourceId)) return undefined;
  return servers.find(
    (server) =>
      server.sourceId === widget.sourceId && server.declaredName === link.mcp_server,
  );
}

export function activeMcpLink(
  widget: LinkedWidget | undefined,
  tools: AgentToolConfig[],
  servers: McpServer[],
): ActiveMcpLink | undefined {
  const server = linkedServer(widget, servers);
  const link = widget?.mcp_tool;
  if (!(server && link)) return undefined;
  const tool = tools.find(
    (t) => t.server_id === server.id && t.tool_name === link.tool_id,
  );
  if (!tool) return undefined;
  return {
    server_id: tool.server_id,
    tool_name: tool.tool_name,
    ...(link.args ? { args: link.args } : {}),
  };
}

export function withMcpLinks<R extends object>(
  rows: R[],
  tools: AgentToolConfig[],
  servers: McpServer[],
  widgetOf: (row: R) => LinkedWidget | undefined,
): (R & { mcp_tool?: ActiveMcpLink })[] {
  if (!tools.length) return rows;
  return rows.map((row) => {
    const link = activeMcpLink(widgetOf(row), tools, servers);
    return link ? { ...row, mcp_tool: link } : row;
  });
}

const isParamRef = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("$");

function literals(link: McpToolContractT): [string, unknown][] {
  return Object.entries(link.args ?? {}).filter(([, value]) => !isParamRef(value));
}

interface McpCallCitation<W> {
  widget: W;
  inputArgs: Record<string, unknown>;
  details: Record<string, unknown>;
}

export function citeMcpCall<W extends LinkedWidget & Pick<WidgetT, "params">>(
  server: McpServer,
  toolName: string,
  callArgs: Record<string, unknown>,
  widgets: W[],
): McpCallCitation<W> | null {
  if (!(server.sourceId && server.declaredName)) return null;
  const candidates = widgets
    .map((widget, order) => ({ widget, link: widget.mcp_tool, order }))
    .filter(
      (c): c is { widget: W; link: McpToolContractT; order: number } =>
        c.widget.sourceId === server.sourceId &&
        c.link !== undefined &&
        c.link.mcp_server === server.declaredName &&
        c.link.tool_id === toolName &&
        literals(c.link).every(([arg, value]) => callArgs[arg] === value),
    )
    .sort(
      (a, b) => literals(b.link).length - literals(a.link).length || a.order - b.order,
    );
  if (!candidates.length) return null;
  const { widget: chosen, link } = candidates[0];

  const inputArgs: Record<string, unknown> = {};
  const used = new Set<string>();
  const mapping = link.args;
  if (mapping) {
    for (const [arg, value] of Object.entries(mapping))
      if (isParamRef(value) && arg in callArgs) {
        inputArgs[value.slice(1)] = callArgs[arg];
        used.add(arg);
      }
  } else {
    const params = new Set((chosen.params ?? []).map((param) => param.paramName));
    for (const [arg, value] of Object.entries(callArgs))
      if (params.has(arg)) {
        inputArgs[arg] = value;
        used.add(arg);
      }
  }
  const details = Object.fromEntries(
    Object.entries(callArgs).filter(([arg]) => !used.has(arg)),
  );
  return { widget: chosen, inputArgs, details };
}
