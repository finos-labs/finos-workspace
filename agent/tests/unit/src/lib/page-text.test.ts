import { describe, it } from "node:test";
import { expect } from "expect";
import { excerpt, findInText, MAX_COUNTED_MATCHES, OVERVIEW_EXCERPT_CHARS, readText, renderOverview, sliceChars } from "../../../../src/lib/page-text.ts";
import type { PageOverview } from "../../../../src/lib/page-view.ts";

describe("sliceChars", () => {
  it("is the characters from an offset, and where they are", () => {
    expect(sliceChars("abcdefghij", 2, 3)).toEqual({ chunk: "cde", start: 2, end: 5, total: 10 });
    expect(sliceChars("abcdefghij", 8, 50)).toEqual({ chunk: "ij", start: 8, end: 10, total: 10 });
    expect(sliceChars("abc", 99, 5)).toEqual({ chunk: "", start: 3, end: 3, total: 3 });
    expect(sliceChars("abc", -4, 2).start).toBe(0);
  });
});

describe("readText", () => {
  it("says where the text goes on, or that it ends", () => {
    expect(readText("abcdefghij", 0, 4)).toBe("abcd\n\n[characters 0–4 of 10. Continue at offset 4.]");
    expect(readText("abcdefghij", 8, 4)).toBe("ij\n\n[characters 8–10 of 10. That is the end.]");
    expect(readText("abc", 50, 4)).toBe("The text is 3 characters long and ends before that offset.");
    expect(readText("", 0, 4)).toBe("The page has no readable text.");
  });
});

describe("excerpt", () => {
  it("is the whole text when it fits, and otherwise its start, cut at a paragraph or sentence near the end", () => {
    expect(excerpt("short", 100)).toBe("short");
    const text = `${"a".repeat(80)}\n\n${"b".repeat(80)}`;
    expect(excerpt(text, 100)).toBe("a".repeat(80));
    expect(excerpt(`${"a".repeat(85)}. ${"b".repeat(50)}`, 100)).toBe(`${"a".repeat(85)}.`);
    expect(excerpt("c".repeat(300), 100)).toBe("c".repeat(100));
  });
});

describe("findInText", () => {
  const text = "The cat sat. A dog barked at the CAT. Nothing else, no felines. The cat left.";

  it("finds a phrase without regard to case, with the text around it and where it is", () => {
    const { total, matches } = findInText(text, "cat", { max: 10, context: 6 });
    expect(total).toBe(3);
    expect(matches.map((m) => m.at)).toEqual([text.indexOf("cat"), text.indexOf("CAT"), text.lastIndexOf("cat")]);
    expect(matches[0].snippet).toBe("The cat sat.…");
    expect(text.slice(matches[1].at, matches[1].at + 3)).toBe("CAT");
  });

  it("is a literal: a pattern is not one", () => {
    expect(findInText("a.b a+b", ".", { max: 5 }).total).toBe(1);
    expect(findInText("aaaa", "a*", { max: 5 }).total).toBe(0);
    expect(findInText("x", "", { max: 5 }).matches).toEqual([]);
  });

  it("goes on from the match after those that were shown, and counts them all", () => {
    const many = "word ".repeat(30);
    const { total, matches } = findInText(many, "word", { skip: 10, max: 3, context: 2 });
    expect(total).toBe(30);
    expect(matches).toHaveLength(3);
    expect(matches[0].at).toBe(50);
  });

  it("does not take two matches in one passage for two", () => {
    expect(findInText("cat cat cat", "cat", { max: 10, context: 120 }).total).toBe(1);
  });

  it("stops counting where counting is no use, in time that grows with the text", () => {
    const text = "a ".repeat(2_000_000);
    const start = performance.now();
    const { counted, total } = findInText(text, "a", { max: 3, context: 1 });
    expect(performance.now() - start).toBeLessThan(1000);
    expect(total).toBe(MAX_COUNTED_MATCHES);
    expect(counted).toBe(`${MAX_COUNTED_MATCHES}+`);
  });

  it("keeps the offsets right in a text whose lower case is longer", () => {
    const text = "İİİ then target here";
    const { matches } = findInText(text, "target", { max: 1 });
    expect(text.slice(matches[0].at, matches[0].at + 6)).toBe("target");
  });
});

describe("renderOverview", () => {
  const overview = (markdown: string): PageOverview => ({
    title: "T",
    description: "About things.",
    language: "en",
    outline: [
      { level: 1, text: "Top" },
      { level: 2, text: "Sub" },
    ],
    counts: { links: 3, tables: 0, images: 0, forms: 0 },
    data: [{ index: 0, kind: "JSON-LD", bytes: 10, summary: "Article" }],
    markdown,
  });
  const render = (markdown: string, pageId: string | null) =>
    renderOverview({ url: "https://x.example/", title: "T", status: 200, contentType: "text/html", bytes: 2048, overview: overview(markdown), pageId, more: (shown, total) => `more after ${shown} of ${total}` });

  it("says what the page is and contains, and gives a short page whole", () => {
    const out = render("A short page.", "p-1");
    expect(out).toBe(
      [
        "Fetched https://x.example/ (HTTP 200, text/html, 2 KB).",
        "page_id: p-1",
        "Title: T",
        "Description: About things.",
        "Outline:",
        "- Top",
        "  - Sub",
        "Contains: 3 links.",
        "Embedded JSON: [0] JSON-LD (Article).",
        "Readable text (all 13 characters):",
        "A short page.",
      ].join("\n"),
    );
  });

  it("gives the start of a long page and says how much there is, never the page", () => {
    const long = `${"word ".repeat(5000)}`;
    const out = render(long, null);
    expect(out).not.toContain("page_id");
    expect(out.length).toBeLessThan(OVERVIEW_EXCERPT_CHARS + 600);
    expect(out).toContain("Readable text (25000 characters in all; the first ");
    expect(out).toMatch(/\[more after \d+ of 25000\]$/);
  });

  it("says when there is no text", () => {
    expect(render("   ", null)).toContain("The page has no readable text.");
  });
});
