import { tool, type ToolSet, type StopCondition } from "ai";
import type { AgentTool, WidgetMcpLink } from "../protocol/types.ts";
import { sanitizeMcpToolName, buildToolInputSchema } from "./schema.ts";
import {
  WORKSPACE_BRIDGE_COMMAND_NAMES,
  BRIDGE_MOUNT_EXTRA_NAMES,
} from "../protocol/bridge-commands.ts";
import { SQL_TOOL_NAME_SET } from "../agent/tools/sql/index.ts";
import { NATIVE_TOOL_NAME_SET } from "../agent/tools/native.ts";
import { isWidgetDataToolName, WIDGET_DATA_TOOL } from "../agent/workspace-widget-data.ts";
import { WORKSPACE_SERVER_ID } from "../protocol/workspace-server.ts";

export interface McpToolEntry {
  serverId: string;
  toolName: string;
  serverToolName?: string;
  sanitizedName: string;
  description: string;
}

export function linkedToolName(
  link: WidgetMcpLink | undefined,
  entries: readonly McpToolEntry[],
): string | undefined {
  if (!link) return undefined;
  return entries.find((entry) => entry.serverId === link.server_id && entry.serverToolName === link.tool_name)
    ?.sanitizedName;
}

export interface McpToolsResult {
  toolSet: ToolSet;
  entries: McpToolEntry[];
  widgetDataEntry?: McpToolEntry;
  workspaceToolsOffered: boolean;
  stopCondition: StopCondition<ToolSet>;
  isMcpToolName: (name: string) => boolean;
}

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

const AGENT_OWNED_WORKSPACE_TOOLS: ReadonlySet<string> = new Set(["get_skill_content"]);

function isOffered(agentTool: AgentTool): boolean {
  if (agentTool.server_id !== WORKSPACE_SERVER_ID) return !isAgentOwnedTool(agentTool.name);
  return !endsWithCanonical(agentTool.name, AGENT_OWNED_WORKSPACE_TOOLS);
}

export function makeMcpTools(agentTools: AgentTool[]): McpToolsResult {
  const toolSet: ToolSet = {};
  const entries: McpToolEntry[] = [];
  const usedNames = new Set<string>();
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
      ...(agentTool.tool_name ? { serverToolName: agentTool.tool_name } : {}),
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
