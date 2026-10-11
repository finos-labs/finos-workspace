import { describe, it, expect, afterEach, mock } from "bun:test";
import { logicalUrl } from "../../helpers/logical-url";
import server from "../../../mcp-server/src/server";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

function post(body: unknown): Promise<Response> {
  return Promise.resolve(
    server.fetch(new Request("http://mcp.test/mcp", { method: "POST", headers: HEADERS, body: JSON.stringify(body) })),
  );
}

/** The JSON-RPC message in a response, whether the server answered as JSON or as one SSE event. */
async function message(res: Response): Promise<{ id: number; result?: { content: { text: string }[] } }> {
  const text = await res.text();
  const data = text.split("\n").find((line) => line.startsWith("data:"));
  return JSON.parse(data ? data.slice(5) : text);
}

describe("MCP server — clients that run at the same time", () => {
  it("answers each client with its own result even though they all count their requests from 1", async () => {
    // Pages that take different times to answer, so that they finish in another order than they began.
    const delays: Record<string, number> = { a: 60, b: 5, c: 35, d: 20, e: 1 };
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const name = new URL(logicalUrl(input, init)).hostname.split(".")[0];
      await new Promise((resolve) => setTimeout(resolve, delays[name]));
      return new Response(`<html><head><title>Page ${name}</title></head><body><p>content of ${name}</p></body></html>`);
    }) as unknown as typeof fetch;

    const names = Object.keys(delays);
    const responses = await Promise.all(
      names.map((name) =>
        post({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "fetch_webpage", arguments: { url: `https://${name}.example.test/` } },
        }),
      ),
    );

    for (const [i, res] of responses.entries()) {
      expect(res.status).toBe(200);
      const reply = await message(res);
      expect(reply.id).toBe(1);
      expect(reply.result?.content[0].text).toContain(`content of ${names[i]}`);
      expect(JSON.stringify(reply)).not.toContain(`content of ${names.find((n) => n !== names[i])}`);
    }
  });

  it("lists the tools without an earlier initialize, as each request stands alone", async () => {
    const reply = await message(await post({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }));
    expect(reply.id).toBe(7);
    const names = (reply as unknown as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names).toContain("web_search");
    expect(names).toContain("fetch_webpage");
  });

  it("has no session to resume and no stream to the client: GET and DELETE are refused with 405", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await Promise.resolve(server.fetch(new Request("http://mcp.test/mcp", { method, headers: HEADERS })));
      expect(res.status).toBe(405);
    }
  });
});
