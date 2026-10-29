import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TOKENS_PATH = path.resolve(__dirname, "../../../src/styles/tokens.css");
const css = fs.readFileSync(TOKENS_PATH, "utf-8");

function extractCustomProperties(block: string): string[] {
  const props: string[] = [];
  const re = /--([\w-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    props.push(`--${m[1]}`);
  }
  return props;
}

function getSemanticBlocks(src: string) {
  const rootBlocks: string[] = [];
  const rootRe = /:root\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rootRe.exec(src)) !== null) {
    rootBlocks.push(m[1]);
  }

  const lightBlock = rootBlocks[1] ?? "";

  const darkRe = /\.dark\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s;
  const darkMatch = darkRe.exec(src);
  const darkBlock = darkMatch?.[1] ?? "";

  return { lightBlock, darkBlock };
}

describe("tokens.css light/dark parity", () => {
  const { lightBlock, darkBlock } = getSemanticBlocks(css);
  const lightTokens = extractCustomProperties(lightBlock);
  const darkTokens = new Set(extractCustomProperties(darkBlock));

  const semanticLight = lightTokens.filter((t) => !t.startsWith("--color-"));

  it("should have parsed semantic tokens from the light block", () => {
    expect(semanticLight.length).toBeGreaterThan(0);
  });

  it("every semantic light token has a dark mode override", () => {
    const missing = semanticLight.filter((t) => !darkTokens.has(t));
    expect(missing).toEqual([]);
  });
});
