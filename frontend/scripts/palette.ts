import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type ColorTree = { [key: string]: string | ColorTree };

const PROPERTY = /^\s*--color-([a-z]+(?:-[a-z]+)?)-(\d+):\s*([^;]+);/gm;

const tokens = readFileSync(
  fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url)),
  "utf8",
);

const values = new Map<string, string>();
export const palette: ColorTree = {};

for (const [, name, step, value] of tokens.matchAll(PROPERTY)) {
  values.set(`${name}-${step}`, value.trim());
  let node = palette;
  for (const part of name.split("-")) {
    node[part] ??= {};
    node = node[part] as ColorTree;
  }
  node[step] = `var(--color-${name}-${step})`;
}

export function paletteValue(name: string, step: string): string {
  const value = values.get(`${name}-${step}`);
  if (value === undefined) throw new Error(`No palette property --color-${name}-${step}`);
  return value;
}
