import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "expect";
import { fn } from "jest-mock";
import {
  parseSearchResults,
  webSearchHandler,
} from "../../../../../mcp-server/src/tools/backend/web-search.ts";

const realFetch = globalThis.fetch;

// The markup of html.duckduckgo.com/html/ as it was returned for a GET: each result's link is a
// redirect whose `uddg` parameter holds the real address, and sponsored rows carry `result--ad`.
function resultRow(href: string, title: string, snippet: string, extraClass = ""): string {
  return `
    <div class="result results_links results_links_deep web-result ${extraClass}">
      <div class="links_main links_deep result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="${href}">${title}</a>
        </h2>
        <div class="result__extras"><a class="result__url" href="${href}"> example.org/page </a></div>
        <a class="result__snippet" href="${href}">${snippet}</a>
      </div>
    </div>`;
}

const redirect = (target: string) =>
  `//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&amp;rut=abc123`;

const PAGE = `<html><body><div id="links" class="results">
  ${resultRow(redirect("https://kafka.apache.org/community/downloads/"), "Downloads - Apache Kafka", "Kafka  <b>4.1</b>\n is the latest release.")}
  ${resultRow("//duckduckgo.com/y.js?ad_domain=ads.example&amp;u3=zzz", "Sponsored thing", "Buy now", "result--ad")}
  ${resultRow(redirect("https://example.org/second?a=1&b=2"), "Second &amp; result", "Second snippet.")}
  ${resultRow(redirect("javascript:alert(1)"), "Not a web link", "ignored")}
  ${resultRow(redirect("https://example.org/third"), "Third", "Third snippet.")}
</div></body></html>`;

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("parseSearchResults", () => {
  it("returns title, decoded target address and a whitespace-collapsed snippet per organic result", () => {
    const results = parseSearchResults(PAGE, 10);
    expect(results[0]).toEqual({
      title: "Downloads - Apache Kafka",
      url: "https://kafka.apache.org/community/downloads/",
      snippet: "Kafka 4.1 is the latest release.",
    });
    expect(results[1].url).toBe("https://example.org/second?a=1&b=2");
    expect(results[1].title).toBe("Second & result");
  });

  it("skips sponsored rows and links that are not http(s)", () => {
    const urls = parseSearchResults(PAGE, 10).map((r) => r.url);
    expect(urls).toEqual([
      "https://kafka.apache.org/community/downloads/",
      "https://example.org/second?a=1&b=2",
      "https://example.org/third",
    ]);
  });

  it("stops at the limit", () => {
    expect(parseSearchResults(PAGE, 2)).toHaveLength(2);
  });

  it("returns nothing for a page without results", () => {
    expect(parseSearchResults("<html><body>no results</body></html>", 5)).toEqual([]);
  });
});

describe("webSearchHandler — happy path", () => {
  it("asks DuckDuckGo with a GET, needs no key, and emits a summary text + one citation per result", async () => {
    let seen: { url: string; method?: string; hasAuth: boolean } | undefined;
    mockFetch((url, init) => {
      seen = {
        url,
        method: init?.method,
        hasAuth: Boolean(new Headers(init?.headers).get("authorization")),
      };
      return new Response(PAGE, { status: 200 });
    });
    const res = await webSearchHandler({ query: "apache kafka release", max_results: 2 });

    const asked = new URL(seen!.url);
    expect(asked.origin + asked.pathname).toBe("https://html.duckduckgo.com/html/");
    expect(asked.searchParams.get("q")).toBe("apache kafka release");
    expect(seen!.method ?? "GET").toBe("GET");
    expect(seen!.hasAuth).toBe(false);

    expect(res.content).toHaveLength(3);
    expect(res.content[0].text).toContain("Downloads - Apache Kafka");
    expect(res.content[0].text).toContain("https://kafka.apache.org/community/downloads/");
    expect(res.content[0].text).toContain("Kafka 4.1 is the latest release.");
    expect(res.content[0].text).toContain("---");
    const c1 = JSON.parse(res.content[1].text);
    expect(c1.$ines_kind).toBe("citation");
    expect(c1.citation).toMatchObject({
      type: "web",
      url: "https://kafka.apache.org/community/downloads/",
      title: "Downloads - Apache Kafka",
    });
    expect(JSON.parse(res.content[2].text).citation.url).toBe("https://example.org/second?a=1&b=2");
  });

  it("defaults to 5 results and caps what the model may ask for at 20", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      resultRow(redirect(`https://example.org/${i}`), `Result ${i}`, `snippet ${i}`),
    ).join("");
    mockFetch(() => new Response(`<html><body>${many}</body></html>`));
    expect((await webSearchHandler({ query: "x" })).content).toHaveLength(1 + 5);
    expect((await webSearchHandler({ query: "x", max_results: 500 })).content).toHaveLength(1 + 20);
    expect((await webSearchHandler({ query: "x", max_results: 0 })).content).toHaveLength(1 + 1);
  });

  it("returns a 'no results' item when the page has none", async () => {
    mockFetch(() => new Response("<html><body>nothing here</body></html>"));
    const res = await webSearchHandler({ query: "no-such-thing" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].text).toContain("No results found");
  });
});

describe("webSearchHandler — failure paths", () => {
  it("reports DuckDuckGo's human-check page (HTTP 202) instead of calling it 'no results'", async () => {
    mockFetch(() => new Response("<html><body>anomaly-modal</body></html>", { status: 202 }));
    const res = await webSearchHandler({ query: "x" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].text).toContain("human check");
  });

  it("surfaces a non-2xx status in a single text item", async () => {
    mockFetch(() => new Response("<html>blocked</html>", { status: 429 }));
    const res = await webSearchHandler({ query: "x" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].text).toContain("Search failed (429)");
  });

  it("returns a timeout text item when the request times out", async () => {
    globalThis.fetch = fn(() => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    const res = await webSearchHandler({ query: "x" });
    expect(res.content[0].text).toContain("timed out");
  });

  it("returns a timeout text item when AbortError is raised", async () => {
    globalThis.fetch = fn(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    const res = await webSearchHandler({ query: "x" });
    expect(res.content[0].text).toContain("timed out");
  });

  it("rethrows other errors so the MCP runtime can surface them", async () => {
    globalThis.fetch = fn(() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    await expect(webSearchHandler({ query: "x" })).rejects.toThrow("boom");
  });
});
