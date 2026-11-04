import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROPERTY = /^\s*--color-([a-z]+(?:-[a-z]+)?)-(\d+):\s*([^;]+);/gm;

const tokens = readFileSync(
  fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url)),
  "utf8",
);

const values = new Map<string, string>();

for (const [, name, step, value] of tokens.matchAll(PROPERTY)) {
  values.set(`${name}-${step}`, value.trim());
}

export function paletteValue(name: string, step: string): string {
  const value = values.get(`${name}-${step}`);
  if (value === undefined) throw new Error(`No palette property --color-${name}-${step}`);
  return value;
}
