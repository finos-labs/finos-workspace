/** Per-server auth strategy declared in an app's `mcpServers` entry. */
export type McpServerAuthType = "oauth" | "token";

export type AppMcpServer = {
  name: string;
  description?: string;
  url: string;
  /** Absent or "oauth" keeps the default OAuth flow; "token" uses a static token. */
  authType?: McpServerAuthType;
};

/** Field descriptor for the token modal when an MCP server uses static-token auth. */
export const MCP_TOKEN_AUTH_FIELD = {
  id: "mcp_token",
  label: "Token",
  key: "Authorization",
  prefix: "Bearer ",
  placeholder: "Paste your access token",
};

export function mcpServerUsesTokenAuth(server: {
  authType?: McpServerAuthType;
}): boolean {
  return server.authType === "token";
}

/** Strips a leading case-insensitive "Bearer " prefix and trims a raw token value. */
export function stripBearerPrefix(value: string): string {
  return value.replace(/^\s*bearer\s+/i, "").trim();
}
