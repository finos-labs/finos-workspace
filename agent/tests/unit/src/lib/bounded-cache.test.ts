import { describe, it, expect } from "bun:test";
import { createBoundedCache } from "../../../../src/lib/bounded-cache";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => void (t += ms) };
}

describe("createBoundedCache", () => {
  it("returns what was set until it expires", () => {
    const c = clock();
    const cache = createBoundedCache<string, number>({ ttlMs: 100, maxEntries: 10, now: c.now });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    c.tick(99);
    expect(cache.get("a")).toBe(1);
    c.tick(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("does not extend an entry's life by reading it", () => {
    const c = clock();
    const cache = createBoundedCache<string, number>({ ttlMs: 100, maxEntries: 10, now: c.now });
    cache.set("a", 1);
    c.tick(60);
    cache.get("a");
    c.tick(60);
    expect(cache.get("a")).toBeUndefined();
  });

  it("frees expired entries that nobody asks for again, when anything is set", () => {
    const c = clock();
    const cache = createBoundedCache<string, number>({ ttlMs: 100, maxEntries: 1000, now: c.now });
    for (let i = 0; i < 500; i++) cache.set(`k${i}`, i);
    c.tick(200);
    cache.set("fresh", 1);
    expect(cache.size).toBe(1);
  });

  it("drops the one used longest ago when there are too many", () => {
    const cache = createBoundedCache<string, number>({ ttlMs: 1e9, maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.get("a"); // a is now the newest
    cache.set("d", 4);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
    expect(cache.size).toBe(3);
  });

  it("keeps the total weight under the limit by dropping the oldest", () => {
    const cache = createBoundedCache<string, string>({ ttlMs: 1e9, maxEntries: 100, weigh: (v) => v.length, maxWeight: 10 });
    cache.set("a", "xxxx");
    cache.set("b", "xxxx");
    cache.set("c", "xxxx");
    expect(cache.weight).toBeLessThanOrEqual(10);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("does not keep an entry that alone is too heavy, and says so", () => {
    const cache = createBoundedCache<string, string>({ ttlMs: 1e9, maxEntries: 100, weigh: (v) => v.length, maxWeight: 10 });
    cache.set("small", "xx");
    expect(cache.set("big", "x".repeat(11))).toBe(false);
    expect(cache.has("big")).toBe(false);
    // ...and does not push out what was there.
    expect(cache.has("small")).toBe(true);
  });

  it("replaces an entry and its weight when the key is set again", () => {
    const cache = createBoundedCache<string, string>({ ttlMs: 1e9, maxEntries: 100, weigh: (v) => v.length });
    cache.set("a", "xxxxx");
    cache.set("a", "xx");
    expect(cache.weight).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("never exceeds its limits however much is set", () => {
    const cache = createBoundedCache<number, number[]>({ ttlMs: 1e9, maxEntries: 50, weigh: (v) => v.length, maxWeight: 1_000 });
    for (let i = 0; i < 10_000; i++) cache.set(i, new Array(1 + (i % 37)).fill(i));
    expect(cache.size).toBeLessThanOrEqual(50);
    expect(cache.weight).toBeLessThanOrEqual(1_000);
  });

  it("clears", () => {
    const cache = createBoundedCache<string, number>({ ttlMs: 1e9, maxEntries: 5 });
    cache.set("a", 1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.weight).toBe(0);
  });
});
