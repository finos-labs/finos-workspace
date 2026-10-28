import type { ContentItem } from "../../lib/typed.ts";
import { bridgeManager } from "../../bridge/singleton.ts";
import { executeBridgeCommand } from "../../bridge/execute.ts";

export const getWorkspaceSnapshotSchema = {} as const;

export const getWorkspaceSnapshotDescription =
  "Request a fresh FINOS Workspace snapshot from the connected browser. " +
  "Call this first when you need current dashboard state, dashboard identifiers across the workspace, or skill identifiers. " +
  "The snapshot is intentionally compact: use list_available_widgets, get_widget_schema, and manage_dashboard for deeper follow-up inspection. " +
  "dashboard_composition exposes deterministic tabs, layout coordinates, and groups for the current dashboard.";

export async function getWorkspaceSnapshotHandler(): Promise<{
  content: ContentItem[];
}> {
  const { content } = await executeBridgeCommand(bridgeManager, {
    command: "get_workspace_snapshot",
  });
  return { content };
}
