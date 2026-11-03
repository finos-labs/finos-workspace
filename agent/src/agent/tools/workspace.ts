import { tool, type Tool, type ToolSet } from "ai";
import { WORKSPACE_BRIDGE_COMMANDS, type WorkspaceBridgeCommandSpec } from "../../protocol/bridge-commands.ts";

function buildTool(spec: WorkspaceBridgeCommandSpec): Tool {
  return tool({
    description: spec.description,
    inputSchema: spec.inputSchema,
  });
}

export function makeWorkspaceTools(enabledNames?: ReadonlySet<string>): ToolSet {
  const out: ToolSet = {};
  for (const spec of WORKSPACE_BRIDGE_COMMANDS) {
    if (enabledNames && !enabledNames.has(spec.name)) continue;
    out[spec.name] = buildTool(spec);
  }
  return out;
}
