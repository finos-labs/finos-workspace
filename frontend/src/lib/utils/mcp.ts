export function getServerName(url: string): string {
  try {
    const { hostname, port } = new URL(url);
    return port ? `${hostname}:${port}` : hostname;
  } catch {
    return "MCP Server";
  }
}

export function isLoopbackUrl(url: string | undefined): boolean {
  try {
    const host = new URL(url ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}
