import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAllowedHeaderName,
  RESERVED_HEADER_NAMES,
} from "~/lib/types/widgetsContract";
import {
  buildWidgetsSchemaKit,
  KIT_PATH,
  serializeKit,
} from "~/lib/types/widgetsSchemaKit";

type Node = Record<string, unknown>;

function closednessProblems(schema: unknown): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const n = node as Node;
    const types = new Set([n.type].flat().filter(Boolean));
    if (types.has("object")) {
      const additional = n.additionalProperties;
      if (
        additional !== false &&
        (typeof additional !== "object" || additional === null)
      )
        problems.push(
          `${path}: an object needs additionalProperties false or a value schema`,
        );
    }
    if (types.has("array") && typeof n.maxItems !== "number")
      problems.push(`${path}: an array needs maxItems`);
    if (
      types.has("string") &&
      !["maxLength", "enum", "const", "pattern", "format"].some((k) => k in n)
    )
      problems.push(`${path}: a string needs a bound`);
    for (const [name, child] of Object.entries((n.properties as Node) ?? {}))
      walk(child, `${path}/properties/${name}`);
    for (const key of ["additionalProperties", "items", "propertyNames"])
      walk(n[key], `${path}/${key}`);
    for (const key of ["anyOf", "oneOf", "allOf"])
      ((n[key] as unknown[]) ?? []).forEach((child, i) =>
        walk(child, `${path}/${key}/${i}`),
      );
    for (const [name, child] of Object.entries((n.definitions as Node) ?? {}))
      walk(child, `${path}/definitions/${name}`);
  };
  walk(schema, "");
  return problems;
}

describe("the widgets.json schema kit", () => {
  const kit = buildWidgetsSchemaKit();

  it("is what the backend has committed", () => {
    const committed = readFileSync(resolve(process.cwd(), KIT_PATH), "utf8");
    expect(committed).toBe(serializeKit(kit));
  });

  it("is closed and bounded everywhere", () => {
    expect(closednessProblems(kit.definitions)).toEqual([]);
    expect(
      closednessProblems({ type: "object", ...kit.base, additionalProperties: false }),
    ).toEqual([]);
    expect(closednessProblems(kit.data)).toEqual([]);
    for (const [type, contract] of Object.entries(kit.types))
      expect(closednessProblems({ properties: contract.properties }), type).toEqual([]);
  });

  it("has no internal fields in the contract", () => {
    for (const key of [
      "widgetId",
      "widgetType",
      "defaultViz",
      "searchCategory",
      "sub_category",
    ])
      expect(kit.base.properties).not.toHaveProperty(key);
    expect(kit.base.required).toEqual(["name", "description", "endpoint"]);
  });

  it("keeps the iframe to GET and the query, and its storage to an MCP URL", () => {
    expect(kit.types.iframe.methods).toEqual(["GET"]);
    expect(kit.types.iframe.locations).toEqual(["query"]);
    expect(Object.keys(kit.types.iframe.properties)).toEqual(["storage"]);
    expect(kit.types.markdown.properties).toEqual({});
  });
});

describe("header param names", () => {
  it("are tokens the browser lets through and the host does not set", () => {
    expect(isAllowedHeaderName("X-Region")).toBe(true);
    for (const name of [
      "Cookie",
      "sec-fetch-mode",
      "Proxy-Authorization",
      "Host",
      "X Region",
      "",
    ])
      expect(isAllowedHeaderName(name), name).toBe(false);
    for (const name of RESERVED_HEADER_NAMES)
      expect(isAllowedHeaderName(name.toUpperCase()), name).toBe(false);
  });
});
