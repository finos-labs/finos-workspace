import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorMessage } from "~/api/errors";
import {
  completeMcpOAuth,
  MCP_AUTH_CHANNEL,
  type McpAuthCallbackMessage,
} from "./mcpServerAuth";

export async function finishMcpSignIn(params: URLSearchParams) {
  const channel = new BroadcastChannel(MCP_AUTH_CHANNEL);
  const notify = (message: McpAuthCallbackMessage) => channel.postMessage(message);
  try {
    const refused = params.get("error");
    if (refused) {
      throw new Error(
        `The sign-in was refused: ${params.get("error_description") || refused}`,
      );
    }
    const code = params.get("code");
    const state = params.get("state");
    if (!(code && state)) throw new Error("The sign-in answer has no code or state.");

    const { serverUrl } = await completeMcpOAuth(code, state).catch((error) => {
      throw new Error(errorMessage(error, "The sign-in could not be completed."));
    });
    notify({ type: "mcp_auth_callback", success: true, serverUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify({ type: "mcp_auth_callback", success: false, error: message });
    throw new Error(message);
  } finally {
    channel.close();
  }
}

export function useMcpAuthCallback() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    finishMcpSignIn(searchParams).then(
      () => window.close(),
      (failure: Error) => setError(failure.message),
    );
  }, [searchParams]);

  return error;
}
