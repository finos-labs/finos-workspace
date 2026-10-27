import { errorItem, textItem, type ContentItem } from "../lib/typed.ts";
import {
  BrowserUnavailableError,
  type BridgeSessionManager,
} from "./state.ts";
import type { WorkspaceCommand, WorkspaceCommandResult } from "./wire.ts";

interface ExecuteBridgeOpts {
  sessionId?: string;
}

export async function executeBridgeCommand(
  manager: BridgeSessionManager,
  command: WorkspaceCommand,
  opts: ExecuteBridgeOpts = {},
): Promise<{ content: ContentItem[]; result: WorkspaceCommandResult | null }> {
  const sessionId = opts.sessionId ?? manager.getFirstConnectedSessionId();
  if (!sessionId) {
    return {
      content: [
        errorItem({
          code: "unavailable",
          message:
            "No connected Workspace browser. Open the workspace and connect the bridge before calling this tool.",
          retryable: true,
        }),
      ],
      result: null,
    };
  }

  let result: WorkspaceCommandResult;
  try {
    result = await manager.executeCommand(sessionId, command);
  } catch (err) {
    if (err instanceof BrowserUnavailableError) {
      return {
        content: [
          errorItem({
            code: "unavailable",
            message: err.message,
            retryable: true,
          }),
        ],
        result: null,
      };
    }
    throw err;
  }

  if (!result.ok) {
    return {
      content: [
        errorItem({
          code: result.error?.code ?? "command_failed",
          message: result.message,
          retryable: result.error?.retryable ?? false,
        }),
      ],
      result,
    };
  }

  return { content: [textItem(JSON.stringify(result))], result };
}
