import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AI_FEATURE_DESCRIPTIONS, ALL_AI_FEATURES } from "~/lib/constants";
import { agentEntrySchema } from "~/lib/state/copilot";

const OUT = process.env.REFERENCE_OUT ?? "";

function undescribed(node: unknown, path: string): string[] {
  if (node === null || typeof node !== "object") return [];
  const schema = node as Record<string, unknown>;
  const properties = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const found = Object.entries(properties ?? {}).flatMap(([name, property]) => [
    ...(typeof property.description === "string" && property.description.trim() !== ""
      ? []
      : [`${path}.${name}`]),
    ...undescribed(property, `${path}.${name}`),
  ]);
  return [
    ...found,
    ...undescribed(schema.additionalProperties, `${path}.*`),
    ...undescribed(schema.items, `${path}[]`),
    ...((schema.anyOf as unknown[] | undefined) ?? []).flatMap((item) =>
      undescribed(item, path),
    ),
  ];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const FEATURE_READS = [
  /features\??\.\[\s*"([a-z][a-z-]*)"\s*\]/g,
  /selectedCopilot\??\.features\??\.([a-z][a-z-]*)/g,
];

describe("the agents.json reference", () => {
  const schema = z.toJSONSchema(agentEntrySchema, {
    reused: "inline",
    target: "draft-7",
  });

  it("describes every field of an agent", () => {
    expect(undescribed(schema, "agent")).toEqual([]);
  });

  it("describes every feature that the code reads", () => {
    const read = new Set<string>();
    for (const file of sourceFiles(resolve("src"))) {
      const text = readFileSync(file, "utf8");
      for (const pattern of FEATURE_READS) {
        for (const match of text.matchAll(pattern)) read.add(match[1] as string);
      }
    }
    expect([...read].filter((key) => !ALL_AI_FEATURES.has(key))).toEqual([]);
  });

  it("writes the reference data", () => {
    if (OUT === "") return;
    mkdirSync(resolve(OUT), { recursive: true });
    writeFileSync(
      resolve(OUT, "agents-reference.json"),
      `${JSON.stringify({ schema, features: AI_FEATURE_DESCRIPTIONS }, null, 2)}\n`,
    );
  });
});
