import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** The fixed segments directly under `/app` that the router defines. */
function definedAppRoutes(): Set<string> {
  const main = fs.readFileSync(path.join(SRC, "main.tsx"), "utf8");
  const appBlock = main.slice(
    main.indexOf('path: "/app"'),
    main.indexOf('path: "/admin"'),
  );
  return new Set([...appBlock.matchAll(/path: "([a-z][a-z-]*)"/g)].map((m) => m[1]));
}

describe("in-app link targets", () => {
  // When a route is removed, links that still point at it show "Page not found".
  // A dashboard id is a uuid and never a word, so a literal `/app/<word>` has to be a defined route.
  it("every literal /app/<word> link or navigation target is a route the router defines", () => {
    const defined = definedAppRoutes();
    expect(defined.has("widgets")).toBe(true);
    expect(defined.has("ai")).toBe(true);

    // Link and navigation targets only: `to=`, `href=`, `navigate(` and `setPendingNavigation(`.
    // Other `/app/...` strings are backend API paths.
    const target =
      /(?:\bto=\{?|\bhref=\{?|\bnavigate\(|\bsetPendingNavigation\()\s*["'`]\/app\/([a-z][a-z-]*)(?=[/?#"'`])/g;
    const broken: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(target)) {
        if (!defined.has(m[1]))
          broken.push(`${path.relative(SRC, file)}: /app/${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
