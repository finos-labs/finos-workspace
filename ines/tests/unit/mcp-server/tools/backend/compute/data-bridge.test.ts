import { describe, it, expect } from "bun:test";
import { readDecoration } from "../../../../../../mcp-server/src/tools/backend/compute/data-bridge";

describe("readDecoration", () => {
  it("requires x-ines-conversation-id", () => {
    expect(() => readDecoration({})).toThrow(/missing x-ines-conversation-id/);
    expect(() => readDecoration({ "x-ines-conversation-id": "" })).toThrow();
    expect(() => readDecoration({ "x-ines-conversation-id": 123 as unknown })).toThrow();
  });

  it("returns conversationId and undefined tables when no tables shipped", () => {
    expect(readDecoration({ "x-ines-conversation-id": "c1" })).toEqual({
      conversationId: "c1",
      tables: undefined,
    });
  });

  it("preserves tables when shape is correct", () => {
    const out = readDecoration({
      "x-ines-conversation-id": "c1",
      "x-ines-tables": { prices: [{ a: 1 }] },
    });
    expect(out.tables).toEqual({ prices: [{ a: 1 }] });
  });

  it("filters non-array entries from tables and drops if all filtered", () => {
    const out = readDecoration({
      "x-ines-conversation-id": "c1",
      "x-ines-tables": { ok: [{ a: 1 }], notArray: "string" as unknown },
    });
    expect(out.tables).toEqual({ ok: [{ a: 1 }] });

    const empty = readDecoration({
      "x-ines-conversation-id": "c1",
      "x-ines-tables": { notArray: "string" as unknown },
    });
    expect(empty.tables).toBeUndefined();
  });

  it("ignores arrays or null in the tables param", () => {
    const out = readDecoration({
      "x-ines-conversation-id": "c1",
      "x-ines-tables": [1, 2, 3] as unknown,
    });
    expect(out.tables).toBeUndefined();

    const nullTables = readDecoration({
      "x-ines-conversation-id": "c1",
      "x-ines-tables": null as unknown,
    });
    expect(nullTables.tables).toBeUndefined();
  });
});
