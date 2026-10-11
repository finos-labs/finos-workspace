import { describe, it, expect, beforeEach } from "bun:test";
import { MAX_CACHED_TABLE_ROWS, getCachedRows, rememberRows } from "../../../../src/agent/row-cache";

beforeEach(() => {
  (globalThis as { __ines_chat_row_cache?: Map<string, unknown> })
    .__ines_chat_row_cache?.clear();
});

describe("getCachedRows", () => {
  it("returns empty map when conversationId is empty", async () => {
    expect((await getCachedRows("")).size).toBe(0);
  });

  it("returns empty map when chat has no entry", async () => {
    expect((await getCachedRows("never-cached")).size).toBe(0);
  });

  it("returns a snapshot copy (mutating it does not affect the cache)", async () => {
    rememberRows("c1", "t1", [{ a: 1 }]);
    const snap = await getCachedRows("c1");
    snap.set("evil", []);
    expect((await getCachedRows("c1")).has("evil")).toBe(false);
  });
});

describe("rememberRows", () => {
  it("stores rows under tableName scoped to conversationId", async () => {
    rememberRows("c1", "t1", [{ a: 1 }, { a: 2 }]);
    const out = await getCachedRows("c1");
    expect(out.get("t1")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("isolates by conversation id", async () => {
    rememberRows("c1", "t1", [{ a: 1 }]);
    rememberRows("c2", "t1", [{ b: 2 }]);
    expect((await getCachedRows("c1")).get("t1")).toEqual([{ a: 1 }]);
    expect((await getCachedRows("c2")).get("t1")).toEqual([{ b: 2 }]);
  });

  it("overwrites prior rows for the same (chat, table) on subsequent writes", async () => {
    rememberRows("c1", "t1", [{ a: 1 }]);
    rememberRows("c1", "t1", [{ a: 2 }, { a: 3 }]);
    expect((await getCachedRows("c1")).get("t1")).toEqual([{ a: 2 }, { a: 3 }]);
  });

  it("no-ops on missing conversationId", async () => {
    rememberRows("", "t1", [{ a: 1 }]);
    expect((await getCachedRows("")).size).toBe(0);
  });

  it("no-ops on empty rows", async () => {
    rememberRows("c1", "t1", []);
    expect((await getCachedRows("c1")).size).toBe(0);
  });
});

describe("row cache — bounded", () => {
  it("does not keep a table that is too big to be worth keeping, and keeps the others of the chat", async () => {
    rememberRows("chat-big", "small", [{ a: 1 }]);
    rememberRows("chat-big", "huge", Array.from({ length: MAX_CACHED_TABLE_ROWS + 1 }, (_, i) => ({ i })));
    const rows = await getCachedRows("chat-big");
    expect(rows.has("huge")).toBe(false);
    expect(rows.get("small")).toEqual([{ a: 1 }]);
  });

  it("keeps the chats used last when there are more chats than it holds", async () => {
    for (let i = 0; i < 2_500; i++) rememberRows(`chat-${i}`, "t", [{ i }]);
    expect((await getCachedRows("chat-0")).size).toBe(0);
    expect((await getCachedRows("chat-2499")).size).toBe(1);
  });

  it("drops the oldest chats when the rows held are too many", async () => {
    const rows = Array.from({ length: 400_000 }, (_, i) => ({ i }));
    for (let i = 0; i < 20; i++) rememberRows(`wide-${i}`, "t", rows);
    // 5,000,000 rows in all: twelve of these fit.
    expect((await getCachedRows("wide-0")).size).toBe(0);
    expect((await getCachedRows("wide-19")).size).toBe(1);
  });
});
