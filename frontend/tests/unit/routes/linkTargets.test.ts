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

function definedAppRoutes(): Set<string> {
  const main = fs.readFileSync(path.join(SRC, "main.tsx"), "utf8");
  const appBlock = main.slice(
    main.indexOf('path: "/app"'),
    main.indexOf('path: "/admin"'),
  );
  return new Set([...appBlock.matchAll(/path: "([a-z][a-z-]*)"/g)].map((m) => m[1]));
}

describe("in-app link targets", () => {
  it("every literal /app/<word> link or navigation target is a route the router defines", () => {
    const defined = definedAppRoutes();
    expect(defined.has("widgets")).toBe(true);
    expect(defined.has("ai")).toBe(true);

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
