import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const repoRoot = resolve(docsRoot, "..");
export const outDir = resolve(docsRoot, "src", "generated");

export function fromRepo(...parts: string[]): string {
  return resolve(repoRoot, ...parts);
}

export function repoRelative(path: string): string {
  return relative(repoRoot, path).split("\\").join("/");
}
