import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const CHAT = join(__dirname, "../../../../src/components/AI");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the markdown of the chat", () => {
  const INERT = [
    "inertImageOverride",
    "InertMarkdownOptions",
    "MarkdownAIMessageOptions",
    "MarkdownAIMessageOverrides",
    "CodeMarkdownOptions",
  ];

  const renderers = sources(CHAT).filter(
    (path) =>
      /from "markdown-to-jsx"/.test(readFileSync(path, "utf8")) &&
      !path.endsWith("MarkdownOverrides.tsx"),
  );

  it("is rendered by files that this test knows about", () => {
    expect(renderers.length).toBeGreaterThanOrEqual(6);
  });

  for (const path of renderers) {
    it(`handles images in ${relative(CHAT, path)}`, () => {
      const source = readFileSync(path, "utf8");
      expect(INERT.some((name) => source.includes(name))).toBe(true);
      expect(source).not.toMatch(/disableParsingRawHTML:\s*false/);
    });
  }

  it("does not render an image element anywhere in the components of the chat", () => {
    const withImg = sources(CHAT).filter((path) =>
      /^\s*<img\b/m.test(readFileSync(path, "utf8")),
    );
    expect(withImg.map((path) => relative(CHAT, path))).toEqual([]);
  });
});
