import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errorMessage } from "~/api/errors";
import {
  completeMcpOAuth,
  MCP_AUTH_CHANNEL,
  type McpAuthCallbackMessage,
} from "./mcpServerAuth";

/**
 * Hands the authorization server's answer to the API, which exchanges the code and keeps
 * the grant, then tells the page that opened the sign-in popup. Rejects with what went
 * wrong, which the opener hears too.
 */
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

/**
 * The /oauth/callback page in the sign-in popup: finishes the sign-in once and closes the
 * window. Returns the error to show when it fails.
 */
export function useMcpAuthCallback() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  // The answer is single-use: a second run (a re-render, React's strict mode) would fail it
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
