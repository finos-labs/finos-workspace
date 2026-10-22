import { describe, it } from "node:test";
import { expect } from "expect";
import { htmlTableArtifact, renderHtmlTable } from "../../../../src/protocol/html-table.ts";

// The Workspace has no table artifact: a table is an html artifact, styled per
// Ines's own `html-table` skill (its exact colors, no borders, no title
// repeated inside the HTML, theme background on the outermost element).
describe("renderHtmlTable", () => {
  const html = renderHtmlTable([
    { ticker: "AAPL", price: 190.5, note: null },
    { ticker: "MSFT", price: 410.25, extra: "x" },
  ]);

  it("uses the union of the rows' keys as columns", () => {
    expect(html).toContain("<th>ticker</th>");
    expect(html).toContain("<th>note</th>");
    expect(html).toContain("<th>extra</th>");
  });

  it("right-aligns numeric columns only", () => {
    expect(html).toContain('<th class="num">price</th>');
    expect(html).toContain('<td class="num">190.5</td>');
    expect(html).toContain("<td>AAPL</td>");
  });

  it("escapes cell and header text", () => {
    const out = renderHtmlTable([{ "<b>": "a & b" }]);
    expect(out).toContain("<th>&lt;b&gt;</th>");
    expect(out).toContain("<td>a &amp; b</td>");
  });

  it("follows the html-table skill: its colors, no borders, theme on the outer element", () => {
    for (const color of ["#FFFFFF", "#F6F6F6", "#EBEBED", "#191D1F", "#1F1E23", "#2A2A31", "#36363E", "#0b2432"]) {
      expect(html).toContain(color);
    }
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("html,body{margin:0;padding:0;background:");
    expect(html).toContain("border:0");
    expect(html).not.toMatch(/border:\s*1px/);
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it("emits no script", () => {
    expect(html).not.toContain("<script");
  });
});

describe("htmlTableArtifact", () => {
  it("is an html artifact carrying the table", () => {
    const a = htmlTableArtifact("Prices", "Latest prices", [{ a: 1 }]);
    expect(a.type).toBe("html");
    expect(a.name).toBe("Prices");
    expect(a.description).toBe("Latest prices");
    expect(a.content).toContain("<table>");
    expect(a.uuid.length).toBeGreaterThan(10);
  });
});
