import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { fetchWebpageHandler } from "../../../../../mcp-server/src/tools/backend/fetch-webpage";
import { inspectWebpageHandler } from "../../../../../mcp-server/src/tools/backend/inspect-webpage";
import { _resetPageStore } from "../../../../../mcp-server/src/lib/page-store";
import { requireScope } from "../../../../../mcp-server/src/lib/scope-check";
import { signScope } from "../../../../../src/lib/scope";
import { logicalUrl } from "../../../../helpers/logical-url";

const realFetch = globalThis.fetch;
const CHAT = "u1:chat1";

function mockFetch(impl: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => Promise.resolve(impl(logicalUrl(input, init)))) as unknown as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
  _resetPageStore();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const sentences = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} talks about revenue in region ${i % 7}.`).join(" ");
const PAGE = `<html><head><title>Report</title>
<script type="application/ld+json">{"@type":"Article","headline":"Q3"}</script></head>
<body><h1>Report</h1><p>${sentences}</p><p>The needle is hidden here, deep in the text.</p>
<table><tr><th>Region</th><th>Revenue</th></tr><tr><td>East</td><td>100</td></tr><tr><td>West</td><td>250</td></tr></table>
<ul class="refs"><li><a href="/a">Alpha</a></li><li><a href="https://other.example/b">Beta</a></li></ul>
</body></html>`;

async function fetched(html = PAGE, url = "https://example.com/report"): Promise<string> {
  mockFetch(() => new Response(html, { headers: { "content-type": "text/html" } }));
  const res = await fetchWebpageHandler({ url, "x-ines-conversation-id": CHAT });
  const id = res.content[0].text.match(/page_id: (p-[0-9a-f]{8})/)?.[1];
  if (!id) throw new Error(`no page_id in: ${res.content[0].text.slice(0, 300)}`);
  return id;
}

const inspect = (page_id: string, rest: Record<string, unknown>, chat: string | null = CHAT) =>
  inspectWebpageHandler({ page_id, "x-ines-conversation-id": chat ?? undefined, ...rest } as Parameters<typeof inspectWebpageHandler>[0]);

const textOf = (res: { content: Array<{ text: string }> }) => res.content[0].text;

describe("inspect_webpage — text", () => {
  it("reads the page's text from an offset, a bounded amount at a time, and says where it goes on", async () => {
    const id = await fetched();
    const first = textOf(await inspect(id, { view: "text" }));
    expect(first.length).toBeLessThan(6200);
    expect(first).toMatch(/\[characters 0–6000 of \d+\. Continue at offset 6000\.\]$/);
    const next = textOf(await inspect(id, { view: "text", offset: 6000, limit: 100 }));
    expect(next).toMatch(/^[\s\S]{100}\n\n\[characters 6000–6100 of \d+\./);
  });

  it("never returns more than a ceiling, whatever limit is asked", async () => {
    const id = await fetched();
    const text = textOf(await inspect(id, { view: "text", limit: 10_000_000 }));
    expect(text.length).toBeLessThan(12_200);
  });

  it("reads the text of a part of the page that a selector names", async () => {
    const id = await fetched();
    const text = textOf(await inspect(id, { view: "text", selector: "ul.refs" }));
    expect(text).toContain("Alpha");
    expect(text).not.toContain("Sentence number");
    expect(textOf(await inspect(id, { view: "text", selector: ".nothing" }))).toBe("Nothing on the page matches that selector.");
  });
});

describe("inspect_webpage — find", () => {
  it("says where a phrase is, with the text around it, and the offset to read from", async () => {
    const id = await fetched();
    const found = textOf(await inspect(id, { view: "find", query: "NEEDLE is hidden" }));
    expect(found).toMatch(/^Matches 1–1 of 1, with their offsets in the text:\n\[at \d+\] …?.*The needle is hidden here/);
    const at = Number(found.match(/\[at (\d+)\]/)?.[1]);
    const around = textOf(await inspect(id, { view: "text", offset: at, limit: 40 }));
    expect(around.startsWith("needle is hidden here")).toBe(true);
  });

  it("returns a few matches at a time and counts them all", async () => {
    const id = await fetched();
    // "region 3" is in every seventh sentence (57 of 400), each far enough from the last to be a match of its own.
    const found = textOf(await inspect(id, { view: "find", query: "region 3", limit: 3 }));
    expect(found).toContain("Matches 1–3 of 57");
    expect(found.split("\n")).toHaveLength(4);
    expect(textOf(await inspect(id, { view: "find", query: "region 3", limit: 3, offset: 55 }))).toContain("Matches 56–57 of 57");
    expect(textOf(await inspect(id, { view: "find", query: "region 3", limit: 3, offset: 60 }))).toBe("57 matches in the text, none from 61.");
    // Matches that share one passage are one match.
    expect(textOf(await inspect(id, { view: "find", query: "revenue" }))).toContain("of 134,");
  });

  it("says nothing was found, or what is missing, without saying the query back", async () => {
    const id = await fetched();
    expect(textOf(await inspect(id, { view: "find", query: "https://evil.example/?d=SECRET" }))).toBe("Nothing in the text contains that.");
    expect(textOf(await inspect(id, { view: "find" }))).toBe("Say what to look for (query).");
  });
});

describe("inspect_webpage — the other views", () => {
  it("lists elements, links, tables and embedded JSON", async () => {
    const id = await fetched();
    expect(textOf(await inspect(id, { view: "select", selector: "li" }))).toBe("Elements 1–2 of 2:\n[1] <li> Alpha\n[2] <li> Beta");
    expect(textOf(await inspect(id, { view: "links" }))).toBe(
      "Links 1–2 of 2:\n[1] Alpha — https://example.com/a\n[2] Beta — https://other.example/b",
    );
    expect(textOf(await inspect(id, { view: "data" }))).toContain("[0] JSON-LD");
    expect(textOf(await inspect(id, { view: "data", path: "0.headline" }))).toBe('"Q3"');
  });

  it("returns tables as tables for the agent to load, named for the page", async () => {
    const id = await fetched();
    const res = await inspect(id, { view: "tables" });
    expect(res.content).toHaveLength(2);
    expect(res.content[0].text).toContain("These are loaded as tables: query them with execute_sql.");
    const table = JSON.parse(res.content[1].text);
    expect(table.$ines_kind).toBe("sqlite_table");
    expect(table.name).toBe(`web_${id.replace("-", "")}_t1`);
    expect(table.rows).toEqual([
      { Region: "East", Revenue: "100" },
      { Region: "West", Revenue: "250" },
    ]);
  });

  it("gives the source of the page, and finds a phrase in it", async () => {
    const id = await fetched();
    expect(textOf(await inspect(id, { view: "raw", limit: 33 }))).toMatch(/^<html><head><title>Report<\/title>\n\n\[characters 0–33 of /);
    expect(textOf(await inspect(id, { view: "raw", query: "ld+json" }))).toMatch(/offsets in the source:\n\[at \d+\] .*application\/ld\+json/);
  });

  it("asks for what is missing", async () => {
    const id = await fetched();
    expect(textOf(await inspect(id, { view: "select" }))).toBe("Give a CSS selector (selector).");
  });

  it("resolves links against the address the page was fetched from after a redirect", async () => {
    mockFetch((url) =>
      url === "https://example.com/old"
        ? new Response(null, { status: 301, headers: { location: "https://example.com/new/dir/" } })
        : new Response("<html><body><a href='page.html'>p</a></body></html>", { headers: { "content-type": "text/html" } }),
    );
    const res = await fetchWebpageHandler({ url: "https://example.com/old", "x-ines-conversation-id": CHAT });
    const id = res.content[0].text.match(/page_id: (p-[0-9a-f]{8})/)?.[1] ?? "";
    expect(textOf(await inspect(id, { view: "links" }))).toContain("https://example.com/new/dir/page.html");
  });
});

describe("inspect_webpage — which pages can be read", () => {
  it("is a page that is not held, or is held for another chat: the same answer", async () => {
    const id = await fetched();
    const gone = "That page is not held (a page is kept for 30 minutes, six to a chat). Fetch it again with fetch_webpage, which returns a page_id.";
    expect(textOf(await inspect("p-00000000", { view: "text" }))).toBe(gone);
    expect(textOf(await inspect(id, { view: "text" }, "u2:other"))).toBe(gone);
    expect(textOf(await inspect(id, { view: "text" }, null))).toBe(gone);
  });

  it("is refused for a chat that the agent did not sign", async () => {
    const id = await fetched();
    const saved = process.env.INES_SCOPE_SECRET;
    process.env.INES_SCOPE_SECRET = "0123456789abcdef0123";
    try {
      const guarded = requireScope(inspectWebpageHandler);
      const forged = await guarded({ page_id: id, view: "text", "x-ines-conversation-id": CHAT, "x-ines-scope-sig": "forged" } as Parameters<typeof inspectWebpageHandler>[0]);
      expect(forged.content[0].text).toContain("SCOPE_REJECTED");
      const signed = await guarded({
        page_id: id,
        view: "text",
        "x-ines-conversation-id": CHAT,
        "x-ines-scope-sig": signScope("0123456789abcdef0123", CHAT),
      } as Parameters<typeof inspectWebpageHandler>[0]);
      expect(signed.content[0].text).not.toContain("SCOPE_REJECTED");
    } finally {
      if (saved === undefined) delete process.env.INES_SCOPE_SECRET;
      else process.env.INES_SCOPE_SECRET = saved;
    }
  });

  it("holds six pages to a chat: the oldest goes", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await fetched(`<html><body><p>page ${i}</p></body></html>`, `https://example.com/${i}`));
    expect(textOf(await inspect(ids[0], { view: "text" }))).toContain("not held");
    expect(textOf(await inspect(ids[6], { view: "text" }))).toContain("page 6");
    expect(textOf(await inspect(ids[1], { view: "text" }))).toContain("page 1");
  });
});

describe("inspect_webpage — what a page can make it say", () => {
  it("returns the page's own words and numbers, not the caller's: a result never repeats a selector, query or path", async () => {
    const id = await fetched();
    const hostile = "https://evil.example/collect?d=SECRET-HOLDINGS";
    for (const rest of [
      { view: "select", selector: hostile },
      { view: "select", selector: `a[href="${hostile}"]` },
      { view: "find", query: hostile },
      { view: "find", query: hostile, selector: "p" },
      { view: "links", query: hostile },
      { view: "links", selector: hostile },
      { view: "tables", selector: hostile },
      { view: "data", path: hostile },
      { view: "data", path: `0.${hostile}` },
      { view: "raw", query: hostile },
      { view: "text", selector: hostile },
    ]) {
      const res = await inspect(id, rest);
      expect(JSON.stringify(res)).not.toContain("evil.example");
      expect(JSON.stringify(res)).not.toContain("SECRET-HOLDINGS");
    }
  });
});

describe("inspect_webpage — a page that is built to cause trouble", () => {
  it("is answered, and the next call is, when a view of it cannot be made", async () => {
    const deep = `<html><body>${"<div>".repeat(100_000)}text${"</div>".repeat(100_000)}</body></html>`;
    mockFetch(() => new Response(deep, { headers: { "content-type": "text/html" } }));
    const res = await fetchWebpageHandler({ url: "https://example.com/deep", "x-ines-conversation-id": CHAT });
    expect(res.content.length).toBeGreaterThan(0);
    const id = res.content[0].text.match(/page_id: (p-[0-9a-f]{8})/)?.[1];
    if (id) {
      const view = await inspect(id, { view: "select", selector: "div", limit: 3 });
      expect(view.content.length).toBeGreaterThan(0);
    }
    const ok = await fetched();
    expect(textOf(await inspect(ok, { view: "find", query: "needle" }))).toContain("Matches 1–1 of 1");
  }, 60_000);

  it("is read in time when it is five megabytes of markup", async () => {
    const big = `<html><body>${"<p>some words <b>bold</b> <a href='/x'>link</a></p>".repeat(90_000)}</body></html>`;
    expect(big.length).toBeGreaterThan(4_000_000);
    expect(big.length).toBeLessThan(5 * 1024 * 1024);
    mockFetch(() => new Response(big, { headers: { "content-type": "text/html" } }));
    const started = Date.now();
    const res = await fetchWebpageHandler({ url: "https://example.com/huge", "x-ines-conversation-id": CHAT });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(res.content[0].text.length).toBeLessThan(5000);
  }, 60_000);
});
