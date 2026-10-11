import { describe, it, expect, beforeEach } from "bun:test";
import { MAX_CACHED_TABLE_ROWS, getCachedRows, rememberRows } from "../../../../src/agent/row-cache";

beforeEach(() => {
  (globalThis as { __ines_chat_row_cache?: Map<string, unknown> })
    .__ines_chat_row_cache?.clear();
});

describe("getCachedRows", () => {
  it("returns empty map when conversationId is empty", () => {
    expect(getCachedRows("").size).toBe(0);
  });

  it("returns empty map when chat has no entry", () => {
    expect(getCachedRows("never-cached").size).toBe(0);
  });

  it("returns a snapshot copy (mutating it does not affect the cache)", () => {
    rememberRows("c1", "t1", [{ a: 1 }]);
    const snap = getCachedRows("c1");
    snap.set("evil", []);
    expect(getCachedRows("c1").has("evil")).toBe(false);
  });
});

describe("rememberRows", () => {
  it("stores rows under tableName scoped to conversationId", () => {
    rememberRows("c1", "t1", [{ a: 1 }, { a: 2 }]);
    const out = getCachedRows("c1");
    expect(out.get("t1")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("isolates by conversation id", () => {
    rememberRows("c1", "t1", [{ a: 1 }]);
    rememberRows("c2", "t1", [{ b: 2 }]);
    expect(getCachedRows("c1").get("t1")).toEqual([{ a: 1 }]);
    expect(getCachedRows("c2").get("t1")).toEqual([{ b: 2 }]);
  });

  it("overwrites prior rows for the same (chat, table) on subsequent writes", () => {
    rememberRows("c1", "t1", [{ a: 1 }]);
    rememberRows("c1", "t1", [{ a: 2 }, { a: 3 }]);
    expect(getCachedRows("c1").get("t1")).toEqual([{ a: 2 }, { a: 3 }]);
  });

  it("no-ops on missing conversationId", () => {
    rememberRows("", "t1", [{ a: 1 }]);
    expect(getCachedRows("").size).toBe(0);
  });

  it("no-ops on empty rows", () => {
    rememberRows("c1", "t1", []);
    expect(getCachedRows("c1").size).toBe(0);
  });
});

describe("row cache — bounded", () => {
  it("does not keep a table that is too big to be worth keeping, and keeps the others of the chat", () => {
    rememberRows("chat-big", "small", [{ a: 1 }]);
    rememberRows("chat-big", "huge", Array.from({ length: MAX_CACHED_TABLE_ROWS + 1 }, (_, i) => ({ i })));
    const rows = getCachedRows("chat-big");
    expect(rows.has("huge")).toBe(false);
    expect(rows.get("small")).toEqual([{ a: 1 }]);
  });

  it("keeps the chats used last when there are more chats than it holds", () => {
    for (let i = 0; i < 2_500; i++) rememberRows(`chat-${i}`, "t", [{ i }]);
    expect(getCachedRows("chat-0").size).toBe(0);
    expect(getCachedRows("chat-2499").size).toBe(1);
  });

  it("drops the oldest chats when the rows held are too many", () => {
    const rows = Array.from({ length: 400_000 }, (_, i) => ({ i }));
    for (let i = 0; i < 20; i++) rememberRows(`wide-${i}`, "t", rows);
    // 5,000,000 rows in all: twelve of these fit.
    expect(getCachedRows("wide-0").size).toBe(0);
    expect(getCachedRows("wide-19").size).toBe(1);
  });
});
