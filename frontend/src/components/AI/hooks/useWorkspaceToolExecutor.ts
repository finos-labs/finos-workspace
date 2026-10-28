import { isAxiosError } from "axios";
import { useCallback } from "react";
import { prepareWorkspaceToolCall } from "~/api/workspaceTools.api";
import type {
  WorkspaceBridgeCommand,
  WorkspaceBridgeCommandResult,
} from "~/components/AI/workspaceBridgeProtocol";
import type { CopilotDataT } from "~/lib/state/copilot";
import { workspaceToolName } from "~/lib/state/workspaceTools";
import { toError } from "~/lib/utils/utils";
import { useWorkspaceBridgeCommandHandler } from "./useWorkspaceBridgeCommandHandler";

type ExecuteWorkspaceTool = (
  toolName: string,
  parameters?: Record<string, unknown>,
) => Promise<CopilotDataT[]>;

function asToolResult(result: unknown): CopilotDataT[] {
  return [{ items: [{ content: JSON.stringify(result) }] }];
}

function failure(command: string, message: string): WorkspaceBridgeCommandResult {
  return {
    ok: false,
    command,
    request_id: null,
    message,
    error: { code: "command_failed", message, retryable: false },
  };
}

function reasonOf(error: unknown): string {
  if (isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return toError(error).message;
}

export function useWorkspaceToolExecutor(): ExecuteWorkspaceTool {
  const runCommand = useWorkspaceBridgeCommandHandler();

  return useCallback<ExecuteWorkspaceTool>(
    async (toolName, parameters) => {
      const name = workspaceToolName(toolName);
      try {
        const prepared = await prepareWorkspaceToolCall(name, parameters ?? {});
        if (!prepared.command) {
          return asToolResult(
            prepared.result ?? failure(name, `${name} has no command to run.`),
          );
        }
        return asToolResult(
          await runCommand(prepared.command as WorkspaceBridgeCommand),
        );
      } catch (error) {
        return asToolResult(failure(name, reasonOf(error)));
      }
    },
    [runCommand],
  );
}
