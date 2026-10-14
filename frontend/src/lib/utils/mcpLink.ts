import type { WidgetT } from "~/components/types";
import type { AgentToolConfig, McpServer } from "~/lib/state/mcpTools";
import type { McpToolContractT } from "~/lib/types/widgetsContract";

/**
 * A widget's opt-in to one MCP tool of its own backend (docs/widget-plugins/WIDGETS-JSON.md
 * 5): `mcp_tool` names a server the backend's apps.json declares, and a tool on it. The
 * server is found among the registered ones by the backend's source id and the declared
 * name, never by a label a user can edit, so a widget cannot name another backend's server.
 */

type LinkedWidget = Pick<WidgetT, "sourceId"> & { mcp_tool?: McpToolContractT };

/** What the agent is told of a widget's link: the tool as its request lists it. */
export interface ActiveMcpLink {
  server_id: string;
  tool_name: string;
  args?: McpToolContractT["args"];
}

/** The registered server a widget's link names, if its backend declared and registered it. */
export function linkedServer(
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

/**
 * The link when its tool is in the agent's tools for this request: the server connected and
 * enabled, the tool switched on, granted by the user's roles, and MCP tools on for the
 * agent. Otherwise none: the link enables nothing (5.3, rule 4).
 */
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

/**
 * Each row of a widget whose link is active gains it (5.4): the server and the tool as the
 * request's `tools` list them, from the registry, and the mapping as declared.
 */
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

/** The literal (non-`$param`) arguments a link fixes. */
function literals(link: McpToolContractT): [string, unknown][] {
  return Object.entries(link.args ?? {}).filter(([, value]) => !isParamRef(value));
}

export interface McpCallCitation<W> {
  widget: W;
  /** The call's arguments as the widget's params, for finding it on a dashboard */
  inputArgs: Record<string, unknown>;
  /** The arguments that map to no param */
  details: Record<string, unknown>;
}

/**
 * The widget a tool call is cited as (5.3, rule 5, and 5.4): among the widgets of the
 * server's own backend that link to this tool, those whose literal `args` all equal the
 * call's, the one with the most literals first, then the first the backend declares. The
 * call's arguments become the widget's params through the mapping in reverse: a `$param`
 * entry names the param, and without `args` an argument named like a param fills it.
 */
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
