import { describe, it } from "node:test";
import { expect } from "expect";
import {
  buildAllCitations,
  citationUuid,
  buildWidgetCitations,
  buildMcpCitations,
  buildDocumentCitations,
  dedupeCitations,
  pagesNamedIn,
  preferCitationsWithPages,
  selectCitedPages,
} from "../../../../src/protocol/citations.ts";
import type { Citation, Widget } from "../../../../src/protocol/types.ts";
import type { McpCitation } from "../../../../src/mcp/results.ts";

function widget(overrides: Partial<Widget> = {}): Widget {
  return {
    uuid: "u-1",
    origin: "example",
    widget_id: "wid",
    name: "Widget A",
    description: "desc",
    params: [],
    ...overrides,
  };
}

describe("citationUuid", () => {
  it("is deterministic for the same widget uuid + args", async () => {
    const a = await citationUuid("u-1", { x: 1, y: 2 });
    const b = await citationUuid("u-1", { x: 1, y: 2 });
    expect(a).toBe(b);
  });

  it("ignores key order in args", async () => {
    const a = await citationUuid("u-1", { x: 1, y: 2 });
    const b = await citationUuid("u-1", { y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it("produces a UUIDv5-shaped string", async () => {
    const id = await citationUuid("u-1", {});
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("differs when widget uuid or args change", async () => {
    const a = await citationUuid("u-1", { x: 1 });
    const b = await citationUuid("u-1", { x: 2 });
    const c = await citationUuid("u-2", { x: 1 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("buildWidgetCitations", () => {
  it("filters null/undefined/empty-string args from details", async () => {
    const w = widget();
    const cited = new Map([
      ["u-1", { widget: w, inputArgs: { keep: "x", drop_null: null, drop_empty: "", drop_undef: undefined } }],
    ]);
    const out = await buildWidgetCitations(cited);
    expect(out).toHaveLength(1);
    const meta = out[0].source_info as Extract<typeof out[0]["source_info"], { type: "widget" }>;
    expect(meta.metadata.input_args).toEqual({ keep: "x" });
    expect(out[0].details[0]).toMatchObject({
      "Source type": "widget",
      Origin: "example",
      "Data source": "Widget A",
      keep: "x",
    });
  });

  it("uses citationUuid as both id and source_info.uuid", async () => {
    const w = widget();
    const cited = new Map([
      ["u-1", { widget: w, inputArgs: { x: 1 } }],
    ]);
    const out = await buildWidgetCitations(cited);
    const expected = await citationUuid("u-1", { x: 1 });
    expect(out[0].id).toBe(expected);
    expect((out[0].source_info as { uuid: string }).uuid).toBe(expected);
  });

  it("uses widgetUuid from the citation value when the map key is request-scoped", async () => {
    const w = widget();
    const cited = new Map([
      ["u-1|{\"symbol\":\"UNRATE\"}", { widget: w, widgetUuid: "u-1", inputArgs: { symbol: "UNRATE" } }],
    ]);
    const out = await buildWidgetCitations(cited);
    const expected = await citationUuid("u-1", { symbol: "UNRATE" });
    expect(out[0].id).toBe(expected);
    const meta = out[0].source_info as Extract<typeof out[0]["source_info"], { type: "widget" }>;
    expect(meta.metadata.widget_uuid).toBe("u-1");
    expect(meta.metadata.input_args).toEqual({ symbol: "UNRATE" });
  });

  it("cites a file widget as a widget, with the file's name in details", async () => {
    const f = widget({
      uuid: "file-uuid-1",
      widget_id: "file-uuid-1",
      name: "report.pdf",
      metadata: { extension: "pdf" },
    });
    const cited = new Map([
      ["file-uuid-1", { widget: f, inputArgs: {} }],
    ]);
    const out = await buildWidgetCitations(cited);
    expect(out).toHaveLength(1);
    // A widget citation is what the FINOS Workspace can match to the widget on the dashboard.
    expect(out[0].source_info).toMatchObject({ type: "widget", uuid: "file-uuid-1", name: "report.pdf", citable: true });
    expect(out[0].details[0]).toEqual({ Filename: "report.pdf", Extension: "pdf" });
  });

  it("names a file by its original file name when the widget has one", async () => {
    const f = widget({
      uuid: "u-pdf",
      widget_id: "file-u-pdf",
      name: "Project Kestrel Plan",
      metadata: { extension: "pdf", originalFileName: "kestrel-plan.pdf" },
    });
    const out = await buildWidgetCitations(new Map([["u-pdf", { widget: f, inputArgs: {} }]]));
    expect(out[0].details[0]).toMatchObject({ Filename: "kestrel-plan.pdf" });
  });

  it("omits Extension when widget has no extension metadata", async () => {
    const f = widget({
      uuid: "file-uuid-2",
      widget_id: "file-uuid-2",
      name: "notes",
    });
    const cited = new Map([
      ["file-uuid-2", { widget: f, inputArgs: {} }],
    ]);
    const out = await buildWidgetCitations(cited);
    expect(out[0].details[0]).toEqual({ Filename: "notes" });
  });
});

describe("buildDocumentCitations", () => {
  const pdf = widget({
    uuid: "u-pdf",
    widget_id: "file-u-pdf",
    origin: "the backend",
    name: "Project Kestrel Plan",
    metadata: { extension: "pdf", originalFileName: "kestrel-plan.pdf" },
  });

  it("cites a page of a file widget as that widget at that page", async () => {
    const out = await buildDocumentCitations([{ id: "u-pdf", type: "document", uri: "ines-doc://u-pdf#page=3", title: "kestrel-plan.pdf", page: 3 }], [pdf]);
    expect(out).toHaveLength(1);
    expect(out[0].source_info).toMatchObject({
      type: "widget",
      uuid: "u-pdf",
      origin: "the backend",
      widget_id: "file-u-pdf",
      metadata: { input_args: {}, widget_uuid: "u-pdf" },
    });
    expect(out[0].details).toEqual([{ Filename: "kestrel-plan.pdf", Extension: "pdf", Page: 3 }]);
  });

  it("gives each page its own citation id", async () => {
    const out = await buildDocumentCitations(
      [
        { id: "u-pdf", type: "document", uri: "x#page=2", title: "kestrel-plan.pdf", page: 2 },
        { id: "u-pdf", type: "document", uri: "x#page=3", title: "kestrel-plan.pdf", page: 3 },
      ],
      [pdf],
    );
    expect(new Set(out.map((c) => c.id)).size).toBe(2);
  });

  it("cites a document that is no widget of the request as a file, at its page", async () => {
    const out = await buildDocumentCitations([{ id: "elsewhere", type: "document", uri: "x#page=9", title: "old.pdf", page: 9 }], [pdf]);
    expect(out[0].source_info).toMatchObject({ type: "file", name: "old.pdf" });
    expect(out[0].details).toEqual([{ Filename: "old.pdf", Page: 9 }]);
  });
});

describe("pagesNamedIn", () => {
  const named = (answer: string) => [...pagesNamedIn(answer)].sort((a, b) => a - b);

  it("reads the ways an answer says a page", () => {
    expect(named("The budget is on page 2.")).toEqual([2]);
    expect(named("It says so (p. 3).")).toEqual([3]);
    expect(named("See p.4 and P.5")).toEqual([4, 5]);
    expect(named("**Page 7**")).toEqual([7]);
    expect(named("Page: 8")).toEqual([8]);
  });

  it("reads lists and ranges of pages", () => {
    expect(named("on pages 2 and 5")).toEqual([2, 5]);
    expect(named("on pages 2, 4 and 6")).toEqual([2, 4, 6]);
    expect(named("see pp. 3-5")).toEqual([3, 4, 5]);
    expect(named("pages 10 to 12")).toEqual([10, 11, 12]);
  });

  it("reads a page after a no-break space, as models write them", () => {
    expect(named("found on page\u202f3 of the PDF")).toEqual([3]);
    expect(named("found on page\u00a03 of the PDF")).toEqual([3]);
  });

  it("does not take other numbers for pages", () => {
    expect(named("The budget is 731 thousand dollars, up 12 percent, in 2026.")).toEqual([]);
    expect(named("a landing page 40 percent faster")).toEqual([40]); // it says "page 40": nothing else can be told
    expect(named("The page is blank")).toEqual([]);
    expect(named("")).toEqual([]);
  });

  it("does not take a runaway range for pages", () => {
    expect(pagesNamedIn("pages 1-5000").size).toBeLessThan(60);
  });
});

describe("selectCitedPages", () => {
  const hit = (page: number | undefined, score: number, id = "d1") =>
    ({ id, type: "document", uri: "x", title: "plan.pdf", page, score }) as const;

  it("cites the pages the answer names, even when the search scored them low", () => {
    const hits = [hit(2, 0.58), hit(1, 0.08), hit(3, 0.07)];
    const out = selectCitedPages(hits, "The budget is on page 2 and the supplier delay on page 3.");
    expect(out.map((h) => h.page).sort()).toEqual([2, 3]);
  });

  it("does not cite a page the answer names that the search did not return", () => {
    const out = selectCitedPages([hit(2, 0.58), hit(1, 0.08)], "The budget is on page 9.");
    // None of the named pages is a hit: the answer is taken to rest on the best match.
    expect(out.map((h) => h.page)).toEqual([2]);
  });

  it("cites the best matches when the answer names no page", () => {
    const hits = [hit(2, 0.6), hit(4, 0.35), hit(1, 0.1), hit(3, 0.05)];
    expect(selectCitedPages(hits, "The budget is 731 thousand.").map((h) => h.page)).toEqual([2, 4]);
    expect(selectCitedPages(hits).map((h) => h.page)).toEqual([2, 4]);
  });

  it("cites at most three pages without a named page", () => {
    const hits = [hit(1, 0.6), hit(2, 0.59), hit(3, 0.58), hit(4, 0.57), hit(5, 0.56)];
    expect(selectCitedPages(hits)).toHaveLength(3);
  });

  it("cites each page once, even when the search returned several passages of it", () => {
    const hits = [hit(2, 0.6), hit(2, 0.55), hit(3, 0.5)];
    expect(selectCitedPages(hits, "pages 2 and 3").map((h) => h.page)).toEqual([2, 3]);
  });

  it("cites a document without pages once", () => {
    const hits = [hit(undefined, 0.6), hit(undefined, 0.5)];
    expect(selectCitedPages(hits, "pages 2 and 3")).toHaveLength(1);
  });

  it("decides for each document on its own", () => {
    const hits = [hit(2, 0.6, "a"), hit(1, 0.1, "a"), hit(5, 0.7, "b"), hit(1, 0.69, "b")];
    const out = selectCitedPages(hits, "page 1");
    expect(out.map((h) => `${h.id}:${h.page}`).sort()).toEqual(["a:1", "b:1"]);
  });

  it("accepts hits that carry no score", () => {
    const hits = [{ id: "d", type: "document", uri: "x", title: "t", page: 2 } as const, { id: "d", type: "document", uri: "x", title: "t", page: 3 } as const];
    expect(selectCitedPages(hits).map((h) => h.page)).toEqual([2, 3]);
  });
});

describe("preferCitationsWithPages", () => {
  it("drops the citation of the whole file when the file is cited at a page", async () => {
    const pdf = widget({ uuid: "u-pdf", widget_id: "file-u-pdf", name: "plan.pdf", metadata: { extension: "pdf" } });
    const whole = await buildWidgetCitations(new Map([["u-pdf", { widget: pdf, inputArgs: {} }]]));
    const paged = await buildDocumentCitations([{ id: "u-pdf", type: "document", uri: "x", title: "plan.pdf", page: 2 }], [pdf]);
    const out = preferCitationsWithPages([...whole, ...paged]);
    expect(out).toHaveLength(1);
    expect(out[0].details[0]).toMatchObject({ Page: 2 });
  });

  it("keeps the citation of the whole file when no page of it is cited", async () => {
    const pdf = widget({ uuid: "u-pdf", widget_id: "file-u-pdf", name: "plan.pdf" });
    const whole = await buildWidgetCitations(new Map([["u-pdf", { widget: pdf, inputArgs: {} }]]));
    expect(preferCitationsWithPages(whole)).toHaveLength(1);
  });

  it("leaves citations that are not files alone", async () => {
    const w = await buildWidgetCitations(new Map([["u-1", { widget: widget(), inputArgs: {} }]]));
    expect(preferCitationsWithPages(w)).toEqual(w);
  });
});

describe("buildMcpCitations", () => {
  it("maps a web McpCitation to a web-typed Citation", () => {
    const mcp: McpCitation = { id: "id-1", type: "web", url: "https://x", title: "X" };
    const out = buildMcpCitations([mcp]);
    expect(out).toHaveLength(1);
    expect(out[0].source_info.type).toBe("web");
    expect(out[0].details[0]).toEqual({ link: "https://x", title: "X" });
  });

  it("cites a document as a file, with its page", () => {
    const mcp: McpCitation = { id: "id-2", type: "document", uri: "doc://a", title: "A", page: 9 };
    const out = buildMcpCitations([mcp]);
    expect(out[0].source_info.type).toBe("file");
    expect(out[0].details[0]).toEqual({ Filename: "A", Page: 9 });
  });

  it("omits the page of a document citation without one", () => {
    const mcp: McpCitation = { id: "id-3", type: "document", uri: "doc://b", title: "B" };
    const out = buildMcpCitations([mcp]);
    expect("Page" in out[0].details[0]).toBe(false);
  });
});

describe("dedupeCitations", () => {
  it("keeps the first occurrence of a widget citation by widget_uuid + input_args", async () => {
    const w = widget();
    const a = await buildWidgetCitations(new Map([["u-1", { widget: w, inputArgs: { p: 1 } }]]));
    const b = await buildWidgetCitations(new Map([["u-1", { widget: w, inputArgs: { p: 1 } }]]));
    const out = dedupeCitations([...a, ...b]);
    expect(out).toHaveLength(1);
  });

  it("keeps duplicates that differ on input_args", async () => {
    const w = widget();
    const a = await buildWidgetCitations(new Map([["u-1", { widget: w, inputArgs: { p: 1 } }]]));
    const b = await buildWidgetCitations(new Map([["u-1", { widget: w, inputArgs: { p: 2 } }]]));
    expect(dedupeCitations([...a, ...b])).toHaveLength(2);
  });

  it("dedupes web citations by their link (details[0].link)", () => {
    const cits: Citation[] = [
      {
        id: "1",
        source_info: { type: "web", name: "A", citable: true },
        details: [{ link: "https://x", title: "A" }],
        signature: "",
      },
      {
        id: "2",
        source_info: { type: "web", name: "A2", citable: true },
        details: [{ link: "https://x", title: "A again" }],
        signature: "",
      },
    ];
    expect(dedupeCitations(cits)).toHaveLength(1);
  });

  it("dedupes file citations by Filename + Page", () => {
    const cits: Citation[] = [
      {
        id: "1",
        source_info: { type: "file", name: "report.pdf", citable: true },
        details: [{ Filename: "report.pdf", Page: 3 }],
        signature: "",
      },
      {
        id: "2",
        source_info: { type: "file", name: "report.pdf", citable: true },
        details: [{ Filename: "report.pdf", Page: 3 }],
        signature: "",
      },
      {
        id: "3",
        source_info: { type: "file", name: "report.pdf", citable: true },
        details: [{ Filename: "report.pdf", Page: 5 }],
        signature: "",
      },
    ];
    expect(dedupeCitations(cits)).toHaveLength(2);
  });
});

describe("buildAllCitations", () => {
  it("merges all three sources and dedupes", async () => {
    const w = widget();
    const cited = new Map([["u-1", { widget: w, inputArgs: { p: 1 } }]]);
    const mcp: McpCitation[] = [{ id: "m-1", type: "web", url: "https://x", title: "X" }];
    const intermediate: Citation[] = [
      {
        id: "i-1",
        source_info: { type: "web", name: "X", citable: true },
        details: [{ link: "https://x", title: "X" }],
        signature: "",
      },
    ];
    const out = await buildAllCitations(cited, mcp, intermediate);
    // 1 widget + 1 web (mcp web + intermediate web both link to https://x → dedup keeps first)
    expect(out).toHaveLength(2);
  });

  it("preserves order: intermediate → widget → mcp", async () => {
    const w = widget({ uuid: "u-w" });
    const cited = new Map([["u-w", { widget: w, inputArgs: {} }]]);
    const intermediate: Citation[] = [
      {
        id: "i-1",
        source_info: { type: "web", name: "I", citable: true },
        details: [{ link: "https://i", title: "I" }],
        signature: "",
      },
    ];
    const mcp: McpCitation[] = [{ id: "m-1", type: "web", url: "https://m", title: "M" }];
    const out = await buildAllCitations(cited, mcp, intermediate);
    expect(out[0].source_info.name).toBe("I");
    expect(out[2].source_info.name).toBe("M");
  });

  it("cites the pages found in a file widget as that widget, and not the file as a whole", async () => {
    const pdf = widget({ uuid: "u-pdf", widget_id: "file-u-pdf", name: "plan.pdf", metadata: { extension: "pdf" } });
    const cited = new Map([["u-pdf", { widget: pdf, inputArgs: {} }]]);
    const mcp: McpCitation[] = [
      { id: "u-pdf", type: "document", uri: "x#page=2", title: "plan.pdf", page: 2 },
      { id: "u-pdf", type: "document", uri: "x#page=3", title: "plan.pdf", page: 3 },
      { id: "u-pdf", type: "document", uri: "x#page=3", title: "plan.pdf", page: 3 },
    ];
    const out = await buildAllCitations(cited, mcp, [], [pdf]);
    expect(out.map((c) => c.details[0].Page)).toEqual([2, 3]);
    expect(out.every((c) => c.source_info.type === "widget")).toBe(true);
  });

  it("cites the pages the final answer names among those the search returned", async () => {
    const pdf = widget({ uuid: "u-pdf", widget_id: "file-u-pdf", name: "plan.pdf", metadata: { extension: "pdf" } });
    const mcp: McpCitation[] = [
      { id: "u-pdf", type: "document", uri: "x", title: "plan.pdf", page: 2, score: 0.58 },
      { id: "u-pdf", type: "document", uri: "x", title: "plan.pdf", page: 1, score: 0.08 },
      { id: "u-pdf", type: "document", uri: "x", title: "plan.pdf", page: 3, score: 0.07 },
    ];
    const out = await buildAllCitations(new Map(), mcp, [], [pdf], "Budget: page 2. Supplier delay: page 3.");
    expect(out.map((c) => c.details[0].Page)).toEqual([2, 3]);
  });

  it("returns empty array when nothing is provided", async () => {
    expect(await buildAllCitations(new Map(), [], [])).toEqual([]);
  });
});
