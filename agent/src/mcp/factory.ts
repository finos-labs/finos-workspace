import { tool, type ToolSet, type StopCondition } from "ai";
import type { AgentTool } from "../protocol/types";
import { sanitizeMcpToolName, buildToolInputSchema } from "./schema";
import {
  WORKSPACE_BRIDGE_COMMAND_NAMES,
  BRIDGE_MOUNT_EXTRA_NAMES,
} from "../protocol/bridge-commands";
import { SQL_TOOL_NAME_SET } from "../agent/tools/sql";
import { NATIVE_TOOL_NAME_SET } from "../agent/tools/native";
import { isWidgetDataToolName, WIDGET_DATA_TOOL } from "../agent/workspace-widget-data";
import { WORKSPACE_SERVER_ID } from "../protocol/workspace-server";

export interface McpToolEntry {
  serverId: string;
  toolName: string;
  sanitizedName: string;
  description: string;
}

export interface McpToolsResult {
  toolSet: ToolSet;
  entries: McpToolEntry[];
  /** The Workspace's own `get_widget_data` tool, when the request has it: how widgets are read (see workspace-widget-data.ts). */
  widgetDataEntry?: McpToolEntry;
  /**
   * Whether the request has tools of the Workspace's own server. The Workspace's tools are how the agent reads
   * and changes the Workspace then, so it has no function calls of its own for the same (see `workspace-server.ts`).
   */
  workspaceToolsOffered: boolean;
  stopCondition: StopCondition<ToolSet>;
  isMcpToolName: (name: string) => boolean;
}

/**
 * Drop user-supplied MCP wrappers whose name collides with a tool the
 * agent owns natively:
 *   - Workspace bridge commands (Path A native SSE; Path B wrappers exist
 *     only for Claude Desktop and must not double-register). Not `get_widget_data`:
 *     the Workspace's MCP tool of that name is how widgets are read, and the agent's
 *     own is only for a request that does not have it.
 *   - SQL family (in-process on the agent; closure on pendingTables).
 *
 * Match is suffix-based to tolerate workspace's server-slug prefixes
 * (e.g. "inesmcp_manage_dashboard" → "manage_dashboard").
 *
 * The Workspace's own tools are not wrappers of these: see `isOffered`.
 */
function endsWithCanonical(toolName: string, canonical: ReadonlySet<string>): boolean {
  for (const cmd of canonical) {
    if (toolName === cmd || toolName.endsWith(`_${cmd}`)) return true;
  }
  return false;
}

function isAgentOwnedTool(toolName: string): boolean {
  return (
    endsWithCanonical(toolName, WORKSPACE_BRIDGE_COMMAND_NAMES) ||
    endsWithCanonical(toolName, BRIDGE_MOUNT_EXTRA_NAMES) ||
    endsWithCanonical(toolName, SQL_TOOL_NAME_SET) ||
    endsWithCanonical(toolName, NATIVE_TOOL_NAME_SET)
  );
}

/** What the Workspace's server has that the agent has its own tool for: skills are the agent's, with their catalog and round trip. */
const AGENT_OWNED_WORKSPACE_TOOLS: ReadonlySet<string> = new Set(["get_skill_content"]);

/**
 * Whether a tool of the request is registered. The Workspace's tools are, as those of any server, except the
 * agent's own.
 */
function isOffered(agentTool: AgentTool): boolean {
  if (agentTool.server_id !== WORKSPACE_SERVER_ID) return !isAgentOwnedTool(agentTool.name);
  return !endsWithCanonical(agentTool.name, AGENT_OWNED_WORKSPACE_TOOLS);
}

export function makeMcpTools(agentTools: AgentTool[]): McpToolsResult {
  const toolSet: ToolSet = {};
  const entries: McpToolEntry[] = [];
  const usedNames = new Set<string>();
  // The model reads widgets with the Workspace's `get_widget_data` (or else the first one of the request), under its own name.
  const widgetDataTool =
    agentTools.find((agentTool) => agentTool.server_id === WORKSPACE_SERVER_ID && isWidgetDataToolName(agentTool.name)) ??
    agentTools.find((agentTool) => isWidgetDataToolName(agentTool.name));
  let widgetDataEntry: McpToolEntry | undefined;

  for (const agentTool of agentTools) {
    const isWidgetData = agentTool === widgetDataTool;
    if (!isWidgetData && (isWidgetDataToolName(agentTool.name) || !isOffered(agentTool))) continue;
    let sanitized = isWidgetData ? WIDGET_DATA_TOOL : sanitizeMcpToolName(agentTool.name);
    if (usedNames.has(sanitized)) {
      let suffix = 2;
      while (usedNames.has(`${sanitized}_${suffix}`)) suffix++;
      sanitized = `${sanitized}_${suffix}`;
    }
    usedNames.add(sanitized);

    const inputSchema = buildToolInputSchema(agentTool.input_schema);
    const description = agentTool.description ?? agentTool.name;

    toolSet[sanitized] = tool({
      description,
      inputSchema,
    });

    const entry: McpToolEntry = {
      serverId: agentTool.server_id,
      toolName: agentTool.name,
      sanitizedName: sanitized,
      description,
    };
    entries.push(entry);
    if (isWidgetData) widgetDataEntry = entry;
  }

  const mcpToolNames = new Set(entries.map((e) => e.sanitizedName));

  const stopCondition: StopCondition<ToolSet> = ({ steps }) => {
    const lastStep = steps.at(-1);
    if (!lastStep) return false;
    return lastStep.toolCalls.some((tc) => mcpToolNames.has(tc.toolName));
  };

  return {
    toolSet,
    entries,
    widgetDataEntry,
    workspaceToolsOffered: agentTools.some((agentTool) => agentTool.server_id === WORKSPACE_SERVER_ID),
    stopCondition,
    isMcpToolName: (name: string) => mcpToolNames.has(name),
  };
}
