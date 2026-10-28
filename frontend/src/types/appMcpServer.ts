export type McpServerAuthType = "oauth" | "token";

export type AppMcpServer = {
  name: string;
  description?: string;
  url: string;
  authType?: McpServerAuthType;
};

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

export function stripBearerPrefix(value: string): string {
  return value.replace(/^\s*bearer\s+/i, "").trim();
}
