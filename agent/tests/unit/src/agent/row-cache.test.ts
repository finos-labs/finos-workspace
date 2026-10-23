import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import {
  MAX_CACHED_TABLE_ROWS,
  forgetRows,
  getCachedRows,
  getKeptWidgetData,
  keepChatDataIn,
  keepWidgetData,
  rememberRows,
} from "../../../../src/agent/row-cache.ts";
import { createLocalStore, createStore, type Store } from "../../../../src/lib/store.ts";
import type { WidgetItem } from "../../../../src/widgets/parse.ts";

let store: Store;

beforeEach(() => {
  store = createLocalStore();
  keepChatDataIn(store);
});

describe("getCachedRows", () => {
  it("returns empty map when conversationId is empty", async () => {
    expect((await getCachedRows("")).size).toBe(0);
  });

  it("returns empty map when chat has no entry", async () => {
    expect((await getCachedRows("never-cached")).size).toBe(0);
  });

  it("returns a snapshot copy (mutating it does not affect the cache)", async () => {
    await rememberRows("c1", "t1", [{ a: 1 }]);
    const snap = await getCachedRows("c1");
    snap.set("evil", []);
    expect((await getCachedRows("c1")).has("evil")).toBe(false);
  });
});

describe("rememberRows", () => {
  it("stores rows under tableName scoped to conversationId", async () => {
    await rememberRows("c1", "t1", [{ a: 1 }, { a: 2 }]);
    const out = await getCachedRows("c1");
    expect(out.get("t1")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("isolates by conversation id", async () => {
    await rememberRows("c1", "t1", [{ a: 1 }]);
    await rememberRows("c2", "t1", [{ b: 2 }]);
    expect((await getCachedRows("c1")).get("t1")).toEqual([{ a: 1 }]);
    expect((await getCachedRows("c2")).get("t1")).toEqual([{ b: 2 }]);
  });

  it("overwrites prior rows for the same (chat, table) on subsequent writes", async () => {
    await rememberRows("c1", "t1", [{ a: 1 }]);
    await rememberRows("c1", "t1", [{ a: 2 }, { a: 3 }]);
    expect((await getCachedRows("c1")).get("t1")).toEqual([{ a: 2 }, { a: 3 }]);
  });

  it("keeps every table of the chat", async () => {
    await rememberRows("c1", "t1", [{ a: 1 }]);
    await rememberRows("c1", "t2", [{ b: 2 }]);
    expect([...(await getCachedRows("c1")).keys()].sort()).toEqual(["t1", "t2"]);
  });

  it("no-ops on missing conversationId", async () => {
    await rememberRows("", "t1", [{ a: 1 }]);
    expect((await getCachedRows("")).size).toBe(0);
  });

  it("no-ops on empty rows", async () => {
    await rememberRows("c1", "t1", []);
    expect((await getCachedRows("c1")).size).toBe(0);
  });

  it("does not keep a table that is too big to be worth keeping, and keeps the others of the chat", async () => {
    await rememberRows("chat-big", "small", [{ a: 1 }]);
    await rememberRows("chat-big", "huge", Array.from({ length: MAX_CACHED_TABLE_ROWS + 1 }, (_, i) => ({ i })));
    const rows = await getCachedRows("chat-big");
    expect(rows.has("huge")).toBe(false);
    expect(rows.get("small")).toEqual([{ a: 1 }]);
  });
});

describe("forgetRows", () => {
  it("removes one table and keeps the chat's others", async () => {
    await rememberRows("c1", "t1", [{ a: 1 }]);
    await rememberRows("c1", "t2", [{ b: 2 }]);
    await forgetRows("c1", "t1");
    const rows = await getCachedRows("c1");
    expect(rows.has("t1")).toBe(false);
    expect(rows.get("t2")).toEqual([{ b: 2 }]);
    expect(await store.get("rows:c1:t1")).toBeNull();
  });
});

describe("a chat's data is kept in the store and nowhere else", () => {
  const item: WidgetItem = { name: "Prices", uuid: "w-1", content: '[{"close":1}]' };

  it("keeps a table of any size in the store, and nothing of it in this process", async () => {
    const rows = Array.from({ length: 30_000 }, (_, i) => ({ id: i, name: `row ${i} of a table larger than a megabyte` }));
    expect(JSON.stringify(rows).length).toBeGreaterThan(1024 * 1024);
    await rememberRows("c-large", "prices", rows);
    expect(await store.get("rows:c-large:prices")).not.toBeNull();

    // Another store, as on another replica without the shared one: this process has nothing of its own to give.
    keepChatDataIn(createLocalStore());
    expect((await getCachedRows("c-large")).size).toBe(0);

    keepChatDataIn(store);
    expect((await getCachedRows("c-large")).get("prices")).toHaveLength(30_000);
  });

  it("keeps the widget data the browser sent in the store, and nothing of it in this process", async () => {
    await keepWidgetData("scope-1", "w-1:{}", [item]);
    expect(await getKeptWidgetData("scope-1", "w-1:{}")).toEqual([item]);
    expect(await getKeptWidgetData("scope-2", "w-1:{}")).toBeNull();

    keepChatDataIn(createLocalStore());
    expect(await getKeptWidgetData("scope-1", "w-1:{}")).toBeNull();
  });

  it("keeps nothing without a Redis", async () => {
    keepChatDataIn(createStore({} as NodeJS.ProcessEnv).sharedOnly());
    await rememberRows("c1", "t1", [{ a: 1 }]);
    await keepWidgetData("scope-1", "w-1:{}", [item]);
    expect((await getCachedRows("c1")).size).toBe(0);
    expect(await getKeptWidgetData("scope-1", "w-1:{}")).toBeNull();
  });

  it("keeps nothing, and fails nothing, while Redis cannot answer", { timeout: 20_000 }, async () => {
    const withRedis = createStore({ REDIS_URL: "redis://127.0.0.1:6399" } as NodeJS.ProcessEnv);
    try {
      keepChatDataIn(withRedis.sharedOnly());
      await rememberRows("c1", "t1", [{ a: 1 }]);
      await keepWidgetData("scope-1", "w-1:{}", [item]);
      expect((await getCachedRows("c1")).size).toBe(0);
      expect(await getKeptWidgetData("scope-1", "w-1:{}")).toBeNull();
    } finally {
      await withRedis.close();
    }
  });
});
