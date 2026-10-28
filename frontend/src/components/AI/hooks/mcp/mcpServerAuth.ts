import { apiClient } from "~/api/api";
import { fetchBackend } from "~/lib/api";
import { getConfig } from "~/lib/runtimeConfig";

export class McpAuthRequiredError extends Error {
  readonly serverUrl: string;

  constructor(serverUrl: string) {
    super(`HTTP 401: sign-in required for ${serverUrl}`);
    this.name = "McpAuthRequiredError";
    this.serverUrl = serverUrl;
  }
}

export const MCP_AUTH_CHANNEL = "mcp-auth";

export type McpAuthCallbackMessage =
  | { type: "mcp_auth_callback"; success: true; serverUrl?: string }
  | { type: "mcp_auth_callback"; success: false; error: string };

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

export async function startMcpOAuth(serverUrl: string): Promise<string> {
  const { data } = await apiClient.post<{ authorization_url: string }>(
    "/app/mcp-oauth/start",
    { server_url: serverUrl },
  );
  const authorizationUrl = new URL(data.authorization_url);
  if (authorizationUrl.protocol !== "https:" && authorizationUrl.protocol !== "http:") {
    throw new Error("The MCP server gave an invalid sign-in address.");
  }
  return authorizationUrl.toString();
}

export async function completeMcpOAuth(code: string, state: string) {
  const { data } = await apiClient.post<{ server_url?: string } | null>(
    "/app/mcp-oauth/complete",
    { code, state },
  );
  return { serverUrl: data?.server_url };
}

export async function deleteMcpOAuthGrant(serverUrl: string) {
  await apiClient.post("/app/mcp-oauth/disconnect", { server_url: serverUrl });
}

export async function getLocalMcpServerHeaders(
  serverUrl: string,
): Promise<Record<string, string>> {
  try {
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
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        }),
      },
      init?.signal ?? undefined,
    );

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

export function createLocalMcpFetch(headers: Record<string, string>) {
  return (url: string | URL, init?: RequestInit) => {
    const merged = new Headers(init?.headers);
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    return fetch(url, { ...init, headers: merged });
  };
}
