import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { apiClient } from "~/api/api";
import {
  completeMcpOAuth,
  createMcpProxyFetch,
  deleteMcpOAuthGrant,
  McpAuthRequiredError,
  sameMcpServerUrl,
  startMcpOAuth,
} from "~/components/AI/hooks/mcp/mcpServerAuth";
import { fetchBackend } from "~/lib/api";

vi.mock("~/lib/api", () => ({ fetchBackend: vi.fn() }));

const fetchBackendMock = fetchBackend as Mock;
const SERVER = "https://mcp.example.com/mcp";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createMcpProxyFetch", () => {
  it("names the saved server and sends no credential of the page", async () => {
    fetchBackendMock.mockResolvedValue(jsonResponse(200, { jsonrpc: "2.0" }));
    const proxyFetch = createMcpProxyFetch(SERVER);

    await proxyFetch(SERVER, {
      method: "POST",
      headers: { accept: "application/json", "mcp-session-id": "s-1" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });

    const [url, init] = fetchBackendMock.mock.calls[0];
    expect(url).toMatch(/\/app\/mcp-proxy$/);
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({
      server_url: SERVER,
      url: SERVER,
      method: "POST",
      headers: { accept: "application/json", "mcp-session-id": "s-1" },
      body: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    });
    expect(JSON.stringify(sent).toLowerCase()).not.toContain("authorization");
  });

  it("rejects with a sign-in request when the API has no grant for the server", async () => {
    fetchBackendMock.mockResolvedValue(
      jsonResponse(401, { auth_required: true, server_url: SERVER }),
    );

    const error = await createMcpProxyFetch(SERVER)(SERVER, { method: "POST" }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(McpAuthRequiredError);
    expect(error.serverUrl).toBe(SERVER);
    expect(error.message).toContain("401");
  });

  it("answers a 204 as an empty success", async () => {
    fetchBackendMock.mockResolvedValue(new Response(null, { status: 204 }));

    const response = await createMcpProxyFetch(SERVER)(SERVER);

    expect(response.status).toBe(200);
  });
});

describe("the API's OAuth flow", () => {
  it("starts it for the saved server and returns the address to sign in at", async () => {
    (apiClient.post as Mock).mockResolvedValue({
      data: { authorization_url: "https://auth.example.com/authorize?state=s" },
    });

    await expect(startMcpOAuth(SERVER)).resolves.toBe(
      "https://auth.example.com/authorize?state=s",
    );
    expect(apiClient.post).toHaveBeenCalledWith("/app/mcp-oauth/start", {
      server_url: SERVER,
    });
  });

  it("refuses an address that is not a web page", async () => {
    (apiClient.post as Mock).mockResolvedValue({
      data: { authorization_url: "javascript:alert(1)" },
    });

    await expect(startMcpOAuth(SERVER)).rejects.toThrow(/invalid sign-in address/);
  });

  it("hands the code and state to the API to complete it", async () => {
    (apiClient.post as Mock).mockResolvedValue({ data: { server_url: SERVER } });

    await expect(completeMcpOAuth("the-code", "the-state")).resolves.toEqual({
      serverUrl: SERVER,
    });
    expect(apiClient.post).toHaveBeenCalledWith("/app/mcp-oauth/complete", {
      code: "the-code",
      state: "the-state",
    });
  });

  it("disconnects a server with its URL in the body, never in the query string", async () => {
    (apiClient.post as Mock).mockResolvedValue({ status: 204 });

    await deleteMcpOAuthGrant(SERVER);

    expect(apiClient.post).toHaveBeenCalledWith("/app/mcp-oauth/disconnect", {
      server_url: SERVER,
    });
    expect(apiClient.delete).not.toHaveBeenCalled();
  });
});

describe("sameMcpServerUrl", () => {
  it("compares URLs the way the API stores them", () => {
    expect(sameMcpServerUrl("https://MCP.example.com/mcp/", SERVER)).toBe(true);
    expect(sameMcpServerUrl("https://mcp.example.com/other", SERVER)).toBe(false);
    expect(sameMcpServerUrl("not a url", SERVER)).toBe(false);
  });
});
