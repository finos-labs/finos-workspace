import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "expect";
import { prefetchUrls, urlCitationId } from "../../../../src/agent/url-prefetch.ts";
import { logicalUrl } from "../../../helpers/logical-url.ts";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(handler: (url: string) => { status?: number; body?: string }): void {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = logicalUrl(input, init);
    const { status = 200, body = "<html><head><title>OK</title></head><body><p>hi</p></body></html>" } =
      handler(url);
    // Labelled as a server labels a page: a Response of a string is text/plain.
    return new Response(body, { status, statusText: status === 200 ? "OK" : "ERR", headers: { "content-type": "text/html; charset=utf-8" } });
  }) as unknown as typeof fetch;
}

describe("prefetchUrls", () => {
  it("returns empty array for no urls", async () => {
    expect(await prefetchUrls(undefined)).toEqual([]);
    expect(await prefetchUrls([])).toEqual([]);
  });

  it("fetches each URL and gives an overview of it", async () => {
    mockFetch(() => ({
      body: "<html><head><title>Tesla Q4</title></head><body><h1>Revenue</h1><p>21.3B</p></body></html>",
    }));
    const out = await prefetchUrls(["https://x.com/a", "https://y.com/b"]);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("Tesla Q4");
    expect(out[0].overview).toContain("Title: Tesla Q4");
    expect(out[0].overview).toContain("Revenue");
    expect(out[0].overview).toContain("21.3B");
    // The page is not held for the agent, so there is no page_id to read it by.
    expect(out[0].overview).not.toContain("page_id");
  });

  it("falls back to hostname when no title tag present", async () => {
    mockFetch(() => ({ body: "<html><body><p>no title</p></body></html>" }));
    const out = await prefetchUrls(["https://example.com/path"]);
    expect(out[0].title).toBe("example.com");
  });

  it("swallows individual failures and keeps successes", async () => {
    mockFetch((url) =>
      url.includes("bad")
        ? { status: 500 }
        : { body: "<html><title>OK</title><body>data</body></html>" },
    );
    const out = await prefetchUrls(["https://bad.com", "https://good.com"]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://good.com");
  });

  it("caps to 4 URLs", async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return { body: "<html><title>X</title><body>X</body></html>" };
    });
    await prefetchUrls([
      "https://a.com",
      "https://b.com",
      "https://c.com",
      "https://d.com",
      "https://e.com",
      "https://f.com",
    ]);
    expect(calls).toBe(4);
  });

  it("gives the start of a long page, not the page", async () => {
    const paragraphs = Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i} says something about the year.</p>`).join("");
    mockFetch(() => ({ body: `<html><title>Big</title><body><h1>Report</h1>${paragraphs}</body></html>` }));
    const out = await prefetchUrls(["https://big.com"]);
    expect(out[0].overview.length).toBeLessThan(4500);
    expect(out[0].overview).toContain("Paragraph 0 says");
    expect(out[0].overview).not.toContain("Paragraph 399 says");
    expect(out[0].overview).toContain("call fetch_webpage with this address, then inspect_webpage");
  });

  it("strips scripts/styles via turndown.remove", async () => {
    mockFetch(() => ({
      body:
        "<html><title>Z</title><body><script>alert(1)</script><style>.x{}</style><p>visible</p></body></html>",
    }));
    const out = await prefetchUrls(["https://z.com"]);
    expect(out[0].overview).toContain("visible");
    expect(out[0].overview).not.toContain("alert(1)");
    expect(out[0].overview).not.toContain(".x{}");
  });
});

describe("prefetchUrls — a page the user's link leads to that is built to cause trouble", () => {
  it("is not read when it is larger than a page is", async () => {
    mockFetch(() => ({ body: `<html><body>${"x".repeat(6 * 1024 * 1024)}</body></html>` }));
    expect(await prefetchUrls(["https://x.com/big"])).toEqual([]);
  });

  it("does not stop the agent while it is read: the reading is in a process of its own", { timeout: 40_000 }, async () => {
    // A hundred thousand levels deep to read, and a run of unclosed titles, in one page.
    const deep = `<html><head>${"<title".repeat(200_000)}</head><body>${"<div>".repeat(100_000)}text${"</div>".repeat(100_000)}</body></html>`;
    mockFetch(() => ({ body: deep }));
    // Something else in the agent's thread that must keep running while the page is converted.
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    const started = Date.now();
    await prefetchUrls(["https://x.com/deep"]);
    clearInterval(timer);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(ticks).toBeGreaterThan(0);
    mockFetch(() => ({ body: "<html><head><title>Ok</title></head><body><p>fine</p></body></html>" }));
    const next = await prefetchUrls(["https://x.com/ok"]);
    expect(next[0].overview).toContain("fine");
  });
});

describe("urlCitationId", () => {
  it("is deterministic per url", async () => {
    const a = await urlCitationId("https://x.com");
    const b = await urlCitationId("https://x.com");
    expect(a).toBe(b);
  });

  it("differs per distinct url", async () => {
    const a = await urlCitationId("https://x.com");
    const b = await urlCitationId("https://y.com");
    expect(a).not.toBe(b);
  });

  it("returns a uuidv5-shaped string", async () => {
    const id = await urlCitationId("https://x.com");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
