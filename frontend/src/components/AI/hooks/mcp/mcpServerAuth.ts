import { apiClient } from "~/api/api";
import { fetchBackend } from "~/lib/api";
import { getConfig } from "~/lib/runtimeConfig";

/**
 * MCP server credentials live in the FINOS Workspace API, never in the browser: the API keeps
 * each server's headers and the user's OAuth grant encrypted and adds them to the
 * requests it proxies. The page only starts and completes the sign-in flow, and holds
 * the headers of a local server in memory while it talks to that server.
 */

/** The API's answer when the user has not signed in to a server yet. */
export class McpAuthRequiredError extends Error {
  readonly serverUrl: string;

  constructor(serverUrl: string) {
    super(`HTTP 401: sign-in required for ${serverUrl}`);
    this.name = "McpAuthRequiredError";
    this.serverUrl = serverUrl;
  }
}

/** The channel the /oauth/callback window reports a finished sign-in on. */
export const MCP_AUTH_CHANNEL = "mcp-auth";

export type McpAuthCallbackMessage =
  | { type: "mcp_auth_callback"; success: true; serverUrl?: string }
  | { type: "mcp_auth_callback"; success: false; error: string };

/** Whether two MCP server URLs name the same server, compared the way the API stores them. */
export function sameMcpServerUrl(a: string, b: string) {
  const normalize = (value: string) => {
    const url = new URL(value.trim());
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  };
  try {
    return normalize(a) === normalize(b);
  } catch {
    return false;
  }
}

/** Starts the API's OAuth flow for a saved server; returns the URL the user signs in at. */
export async function startMcpOAuth(serverUrl: string): Promise<string> {
  const { data } = await apiClient.post<{ authorization_url: string }>(
    "/app/mcp-oauth/start",
    { server_url: serverUrl },
  );
  // The address comes from the server's own metadata: open nothing but a web page
  const authorizationUrl = new URL(data.authorization_url);
  if (authorizationUrl.protocol !== "https:" && authorizationUrl.protocol !== "http:") {
    throw new Error("The MCP server gave an invalid sign-in address.");
  }
  return authorizationUrl.toString();
}

/** Hands the authorization server's answer to the API, which exchanges it and keeps the grant. */
export async function completeMcpOAuth(code: string, state: string) {
  const { data } = await apiClient.post<{ server_url?: string } | null>(
    "/app/mcp-oauth/complete",
    { code, state },
  );
  return { serverUrl: data?.server_url };
}

/** Forgets the user's sign-in to a server. The server's URL goes in the body, never the URL. */
export async function deleteMcpOAuthGrant(serverUrl: string) {
  await apiClient.post("/app/mcp-oauth/disconnect", { server_url: serverUrl });
}

/**
 * The headers saved for a local server (localhost), which the browser reaches directly.
 * The page keeps them in memory for the connection only. A server that is not saved has
 * none.
 */
export async function getLocalMcpServerHeaders(
  serverUrl: string,
): Promise<Record<string, string>> {
  try {
    // The server's URL goes in the body: a URL with a query string lands in logs
    const { data } = await apiClient.post<{ headers: Record<string, string> }>(
      "/app/mcp-servers/local-headers",
      { url: serverUrl },
    );
    return data.headers;
  } catch (error) {
    console.warn(`[mcp] no saved headers for ${serverUrl}`, error);
    return {};
  }
}

/**
 * A fetch for the MCP SDK that sends every request through the API's proxy, naming the
 * saved server at `serverUrl`. The API adds that server's stored headers and the user's
 * OAuth grant; the browser sends no credential of its own. A 401 that says sign-in is
 * required rejects with {@link McpAuthRequiredError}.
 */
export function createMcpProxyFetch(serverUrl: string) {
  const proxyUrl = `${getConfig().urls.backend}/app/mcp-proxy`;
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetchBackend(
      proxyUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_url: serverUrl,
          url: url.toString(),
          method: init?.method || "GET",
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          // The SDK's messages are JSON-RPC text
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        }),
      },
      init?.signal ?? undefined,
    );

    // Some servers answer ping requests with 204 No Content, which makes the SDK retry
    // forever. Treat 204 as success with an empty response.
    if (response.status === 204) return new Response(null, { status: 200 });

    const isJson = response.headers.get("Content-Type")?.includes("application/json");
    const data = isJson
      ? await response
          .clone()
          .json()
          .catch(() => null)
      : null;

    if (response.status === 401 && data?.auth_required) {
      throw new McpAuthRequiredError(data.server_url || serverUrl);
    }

    // A server that wants a POST where a GET was sent would make the SDK retry forever:
    // answer 405 instead.
    const message = typeof data?.message === "string" ? data.message.toLowerCase() : "";
    if (
      message.includes("use post") ||
      message.includes("json-rpc payload") ||
      message.includes("method not allowed")
    ) {
      return new Response(null, { status: 405, statusText: "Method Not Allowed" });
    }

    return response;
  };
}

/** A fetch for a local server: straight from the browser, with its saved headers added from memory. */
export function createLocalMcpFetch(headers: Record<string, string>) {
  return (url: string | URL, init?: RequestInit) => {
    const merged = new Headers(init?.headers);
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    return fetch(url, { ...init, headers: merged });
  };
}
