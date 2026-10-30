import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("no component spreads a Map, a Set or an iterator, which the build compiles for arrays only", () => {
  const spread = /\[\.\.\.(?:new (?:Map|Set)\b|[\w.]*\.(?:entries|keys|values)\(\))/;
  const found = sources("src/components").filter((file) => spread.test(readFileSync(file, "utf8")));
  assert.deepEqual(found, []);
});
