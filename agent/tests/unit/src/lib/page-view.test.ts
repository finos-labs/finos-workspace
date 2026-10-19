import { describe, it, expect } from "bun:test";
import { overviewOf, viewOf, type PageRequest } from "../../../../src/lib/page-view";

const URL_ = "https://news.example/2026/q3/";

const PAGE = `<html lang="en"><head><title>Quarterly Results &amp; Outlook</title>
<meta name="description" content="Revenue and margins for Q3.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Q3","author":{"name":"A. Writer"}}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"items":[{"name":"one"},{"name":"two"}],"longText":"${"x".repeat(500)}"}}}</script>
<script>var secret = 1;</script></head>
<body><nav><a href="/home">Home</a></nav>
<h1>Quarterly Results</h1><p>Revenue grew <b>12%</b> year over year.</p>
<h2>Segments</h2>
<table><caption>By segment</caption><tr><th>Segment</th><th>Revenue</th></tr><tr><td>Cloud</td><td>1,200</td></tr><tr><td>Devices</td><td>800</td></tr></table>
<h2>More</h2><p><a href="/report.pdf">Full report</a> <a href="https://other.example/x#frag">Other</a> <a href="mailto:a@b.c">mail</a> <a href="javascript:alert(1)">js</a> <a href="/report.pdf">Full report again</a></p>
<img src="a.png"><form action="/s"><input name="q"></form>
<footer>Copyright notice</footer></body></html>`;

const view = (request: PageRequest, html = PAGE) => viewOf(html, URL_, request);

describe("overviewOf", () => {
  const overview = overviewOf(PAGE, URL_);

  it("says what the page is", () => {
    expect(overview.title).toBe("Quarterly Results & Outlook");
    expect(overview.description).toBe("Revenue and margins for Q3.");
    expect(overview.language).toBe("en");
    expect(overview.outline).toEqual([
      { level: 1, text: "Quarterly Results" },
      { level: 2, text: "Segments" },
      { level: 2, text: "More" },
    ]);
  });

  it("says what it contains", () => {
    expect(overview.counts).toEqual({ links: 6, tables: 1, images: 1, forms: 1 });
    expect(overview.data.map((d) => [d.index, d.kind, d.summary])).toEqual([
      [0, "JSON-LD", "Article"],
      [1, "Next.js data", "props"],
    ]);
  });

  it("has the readable text as markdown, without what is not read", () => {
    expect(overview.markdown).toContain("# Quarterly Results");
    expect(overview.markdown).toContain("Revenue grew **12%** year over year.");
    expect(overview.markdown).toContain("## Segments");
    expect(overview.markdown).not.toContain("var secret");
    expect(overview.markdown).not.toContain("Copyright notice");
    expect(overview.markdown).not.toContain("Home");
  });

  it("reads a JSON document as one source and its text as the text", () => {
    const body = JSON.stringify({ rows: [{ a: 1 }, { a: 2 }], total: 2 });
    const o = overviewOf(body, URL_, "application/json");
    expect(o.data).toEqual([{ index: 0, kind: "JSON", bytes: body.length, summary: "rows, total" }]);
    expect(o.markdown).toBe(body);
    expect(viewOf(body, URL_, { view: "data", path: "0.rows.1.a", limit: 100 }, "application/json").text).toBe("2");
  });

  it("reads plain text as text", () => {
    const o = overviewOf("just some words", URL_, "text/plain");
    expect(o.markdown).toBe("just some words");
    expect(o.outline).toEqual([]);
  });

  it("copes with an empty page and with markup that is not a page", () => {
    expect(overviewOf("", URL_).markdown).toBe("");
    expect(overviewOf("<<<>>> <p", URL_).title).toBe("");
  });
});

describe("select", () => {
  it("shows the elements that a selector names, with the attributes that identify them and their text", () => {
    const { text } = view({ view: "select", selector: "h2", offset: 0, limit: 10 });
    expect(text).toBe("Elements 1–2 of 2:\n[1] <h2> Segments\n[2] <h2> More");
    const links = view({ view: "select", selector: "a[href^='/report']", offset: 0, limit: 10 }).text;
    expect(links).toContain('<a href="/report.pdf"> Full report');
  });

  it("goes on from an offset", () => {
    expect(view({ view: "select", selector: "h2", offset: 1, limit: 10 }).text).toBe("Elements 2–2 of 2:\n[2] <h2> More");
    expect(view({ view: "select", selector: "h2", offset: 5, limit: 10 }).text).toBe("Elements: 2 in all, none from 6.");
  });

  it("says so when nothing matches, or the selector is not one, and does not repeat it", () => {
    const hostile = "https://evil.example/?d=SECRET";
    for (const selector of [".nothing-has-this", "div[", "::::", hostile, "<script>"]) {
      const { text } = view({ view: "select", selector, offset: 0, limit: 10 });
      expect(text.length).toBeLessThan(80);
      expect(text).not.toContain("evil.example");
      expect(text).not.toContain("SECRET");
    }
  });
});

describe("links", () => {
  it("lists the links with their addresses made absolute, without fragments, once each", () => {
    const { text } = view({ view: "links", offset: 0, limit: 50 });
    expect(text).toBe(
      [
        "Links 1–3 of 3:",
        "[1] Home — https://news.example/home",
        "[2] Full report — https://news.example/report.pdf",
        "[3] Other — https://other.example/x",
      ].join("\n"),
    );
  });

  it("is the links whose text or address has the word, in a part of the page, from an offset", () => {
    expect(view({ view: "links", query: "REPORT", offset: 0, limit: 50 }).text).toBe(
      "Links 1–1 of 1:\n[1] Full report — https://news.example/report.pdf",
    );
    expect(view({ view: "links", selector: "nav", offset: 0, limit: 50 }).text).toBe("Links 1–1 of 1:\n[1] Home — https://news.example/home");
    expect(view({ view: "links", offset: 2, limit: 1 }).text).toBe("Links 3–3 of 3:\n[3] Other — https://other.example/x");
    expect(view({ view: "links", query: "zzz", offset: 0, limit: 50 }).text).toBe("No links.");
  });

  it("resolves against the base address the page names", () => {
    const html = `<html><head><base href="https://cdn.example/base/"></head><body><a href="x.html">x</a></body></html>`;
    expect(view({ view: "links", offset: 0, limit: 5 }, html).text).toContain("https://cdn.example/base/x.html");
  });
});

describe("tables", () => {
  it("returns a table as rows keyed by its headers, and a preview", () => {
    const result = view({ view: "tables", offset: 0, limit: 3, name: "web_p1" });
    expect(result.tables).toEqual([
      {
        name: "web_p1_t1",
        rows: [
          { Segment: "Cloud", Revenue: "1,200" },
          { Segment: "Devices", Revenue: "800" },
        ],
      },
    ]);
    expect(result.text).toContain("Tables 1–1 of 1:");
    expect(result.text).toContain("[1] By segment — 2 rows × 2 columns: Segment, Revenue");
    expect(result.text).toContain("Cloud | 1,200");
  });

  it("names the columns of a table that has no header row, and keeps the names apart", () => {
    const html = `<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table><table><tr><th>x</th><th>x</th><th></th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>`;
    const result = view({ view: "tables", offset: 0, limit: 5, name: "t" }, html);
    expect(result.tables?.[0].rows[0]).toEqual({ column_1: "a", column_2: "b" });
    expect(Object.keys(result.tables?.[1].rows[0] ?? {})).toEqual(["x", "x_2", "column_3"]);
  });

  it("says so when there are none", () => {
    expect(view({ view: "tables", offset: 0, limit: 3, name: "t" }, "<p>no tables</p>").text).toBe("No tables.");
  });
});

describe("data", () => {
  it("lists the JSON a page embeds", () => {
    const lines = view({ view: "data", limit: 6000 }).text.split("\n");
    expect(lines[0]).toBe("JSON in the page (read one with a path that starts with its number, such as 0.name):");
    expect(lines[1]).toMatch(/^\[0\] JSON-LD, \d+ characters: Article$/);
    expect(lines[2]).toMatch(/^\[1\] Next\.js data, \d+ characters: props$/);
    expect(lines).toHaveLength(3);
  });

  it("reads one part by its path, cut to something that can be read", () => {
    expect(view({ view: "data", path: "0.author.name", limit: 6000 }).text).toBe('"A. Writer"');
    expect(view({ view: "data", path: "1.props.pageProps.items.1", limit: 6000 }).text).toBe('{\n  "name": "two"\n}');
    const long = view({ view: "data", path: "1.props.pageProps.longText", limit: 6000 }).text;
    expect(long).toContain("… (500 characters)");
    expect(long.length).toBeLessThan(400);
    expect(view({ view: "data", path: "1.props", limit: 50 }).text.length).toBeLessThanOrEqual(50);
  });

  it("says what is there when the path leads nowhere, without repeating it", () => {
    const hostile = "https://evil.example/?d=SECRET";
    const lost = view({ view: "data", path: `1.props.${hostile}`, limit: 6000 }).text;
    expect(lost).toBe("There is nothing at that path. What is there: pageProps.");
    expect(view({ view: "data", path: "7.x", limit: 6000 }).text).toBe("There is no such source. The sources are numbered 0–1.");
    expect(view({ view: "data", path: "constructor", limit: 6000 }).text).toContain("no such source");
    expect(view({ view: "data", path: "1.__proto__", limit: 6000 }).text).toContain("nothing at that path");
    expect(view({ view: "data", limit: 6000 }, "<p>none</p>").text).toBe("The page embeds no JSON.");
  });

  it("shows a long list as its start and says how many more there are", () => {
    const html = `<script type="application/json">${JSON.stringify({ rows: Array.from({ length: 50 }, (_, i) => i) })}</script>`;
    const text = view({ view: "data", path: "0.rows", limit: 6000 }, html).text;
    expect(text).toContain("… 40 more items");
  });
});

describe("region", () => {
  it("is the readable text of the part of the page a selector names", () => {
    const result = view({ view: "region", selector: "table" });
    expect(result.markdown).toContain("Cloud");
    expect(result.markdown).not.toContain("Revenue grew");
    expect(view({ view: "region", selector: ".none" }).text).toBe("Nothing on the page matches that selector.");
    expect(view({ view: "region", selector: "div[" }).text).toBe("That is not a valid CSS selector.");
  });
});
