/**
 * The store the agent keeps things in between requests.
 *
 * These exercise the process-local store, which is what a deployment without REDIS_URL uses and what
 * the Redis one falls back to when Redis cannot answer. The two are held to the same contract, so a
 * behaviour pinned here is the behaviour either of them has to have; what cannot be checked without a
 * Redis (that two replicas see one another's writes) is what Redis itself guarantees.
 */

import { describe, it, expect } from "bun:test";
import { createLocalStore, createStore, LEASE_TTL_MS } from "../../../../src/lib/store";

describe("values", () => {
  it("gives back what was put in, until the time it was given runs out", async () => {
    let now = 1_000;
    const store = createLocalStore(() => now);
    await store.set("k", "v", 30);
    expect(await store.get("k")).toBe("v");
    now += 29_000;
    expect(await store.get("k")).toBe("v");
    now += 2_000;
    expect(await store.get("k")).toBeNull();
  });

  it("has nothing for a key nothing was put under", async () => {
    expect(await createLocalStore().get("never-set")).toBeNull();
  });

  it("forgets a key that is deleted", async () => {
    const store = createLocalStore();
    await store.set("k", "v", 30);
    await store.del("k");
    expect(await store.get("k")).toBeNull();
  });

  // Redis has one keyspace: DEL removes what is under the key whatever kind it is. A store that
  // deleted only some kinds would end a turn in one deployment and not in the other.
  it("deletes a key whatever kind of thing is under it", async () => {
    const store = createLocalStore();
    await store.set("k", "v", 30);
    await store.putRecord("k2", { a: "1" }, 30);
    await store.take("k3", 5, 60_000);
    await store.lease("k4", 5);

    for (const key of ["k", "k2", "k3", "k4"]) await store.del(key);

    expect(await store.get("k")).toBeNull();
    expect(await store.getRecord("k2")).toBeNull();
    expect(await store.full("k3", 1, 60_000)).toBe(false);
    expect(await store.lease("k4", 1)).not.toBeNull();
  });
});

describe("counting what happened in a window", () => {
  it("allows up to the most in the window and no more", async () => {
    const store = createLocalStore();
    expect(await store.take("k", 2, 60_000)).toBe(true);
    expect(await store.take("k", 2, 60_000)).toBe(true);
    expect(await store.take("k", 2, 60_000)).toBe(false);
  });

  it("lets them through again as the window passes", async () => {
    let now = 0;
    const store = createLocalStore(() => now);
    expect(await store.take("k", 1, 60_000)).toBe(true);
    now += 59_000;
    expect(await store.take("k", 1, 60_000)).toBe(false);
    now += 2_000;
    expect(await store.take("k", 1, 60_000)).toBe(true);
  });

  it("counts each key on its own", async () => {
    const store = createLocalStore();
    expect(await store.take("alice", 1, 60_000)).toBe(true);
    expect(await store.take("bob", 1, 60_000)).toBe(true);
    expect(await store.take("alice", 1, 60_000)).toBe(false);
  });

  // `record` is for what is counted whether or not there was room, and `take` for what is only done
  // when there is. Neither counts past the most: a user who keeps trying is let in when the window
  // has passed, rather than pushing the window along in front of them.
  it("does not count past the most, so that trying again does not push the window along", async () => {
    let now = 0;
    const store = createLocalStore(() => now);
    await store.record("k", 1, 60_000);
    for (let i = 0; i < 50; i++) {
      now += 500;
      await store.record("k", 1, 60_000);
    }
    now = 60_001;
    expect(await store.full("k", 1, 60_000)).toBe(false);
  });

  it("says whether the most have happened without counting one more", async () => {
    const store = createLocalStore();
    expect(await store.full("k", 1, 60_000)).toBe(false);
    await store.record("k", 1, 60_000);
    expect(await store.full("k", 1, 60_000)).toBe(true);
    expect(await store.full("k", 1, 60_000)).toBe(true);
  });
});

describe("places held while something runs", () => {
  it("gives out up to the most at once, and one more when one is given back", async () => {
    const store = createLocalStore();
    const first = await store.lease("k", 2);
    const second = await store.lease("k", 2);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await store.lease("k", 2)).toBeNull();
    await first!();
    expect(await store.lease("k", 2)).not.toBeNull();
  });

  it("gives a place back once, however often it is given back", async () => {
    const store = createLocalStore();
    const held = await store.lease("k", 1);
    await held!();
    await held!();
    expect(await store.lease("k", 1)).not.toBeNull();
    expect(await store.lease("k", 1)).toBeNull();
  });

  // A replica that stops without giving its places back must not hold them for ever, or the whole
  // deployment would lose a place for every query that was running when it stopped.
  it("gives a place back by itself when whoever took it never does", async () => {
    let now = 0;
    const store = createLocalStore(() => now);
    expect(await store.lease("k", 1)).not.toBeNull();
    expect(await store.lease("k", 1)).toBeNull();
    now += LEASE_TTL_MS + 1;
    expect(await store.lease("k", 1)).not.toBeNull();
  });

  it("counts each key on its own", async () => {
    const store = createLocalStore();
    expect(await store.lease("alice", 1)).not.toBeNull();
    expect(await store.lease("bob", 1)).not.toBeNull();
    expect(await store.lease("alice", 1)).toBeNull();
  });
});

describe("records", () => {
  it("gives back the fields that were put in, until the time runs out", async () => {
    let now = 0;
    const store = createLocalStore(() => now);
    await store.putRecord("turn", { requests: "1" }, 600);
    expect(await store.getRecord("turn")).toEqual({ requests: "1" });
    now += 601_000;
    expect(await store.getRecord("turn")).toBeNull();
  });

  it("replaces what was there rather than adding to it", async () => {
    const store = createLocalStore();
    await store.putRecord("k", { a: "1", b: "2" }, 600);
    await store.putRecord("k", { a: "9" }, 600);
    expect(await store.getRecord("k")).toEqual({ a: "9" });
  });

  it("hands out a copy, so that what a caller does with it is not what is stored", async () => {
    const store = createLocalStore();
    await store.putRecord("k", { a: "1" }, 600);
    const taken = (await store.getRecord("k"))!;
    taken.a = "changed";
    expect(await store.getRecord("k")).toEqual({ a: "1" });
  });

  it("adds to a number of a record and says what it became", async () => {
    const store = createLocalStore();
    await store.putRecord("k", { requests: "1" }, 600);
    expect(await store.addToRecord("k", "requests", 1)).toBe(2);
    expect(await store.addToRecord("k", "requests", 1)).toBe(3);
    expect(await store.getRecord("k")).toEqual({ requests: "3" });
  });

  // Otherwise a turn that ran out would be made again by the request that counts against it, and the
  // new one would have no time to live.
  it("adds to nothing when there is no record, rather than making one", async () => {
    const store = createLocalStore();
    expect(await store.addToRecord("gone", "requests", 1)).toBeNull();
    expect(await store.getRecord("gone")).toBeNull();
  });

  it("adds to nothing once the record's time has run out", async () => {
    let now = 0;
    const store = createLocalStore(() => now);
    await store.putRecord("k", { requests: "1" }, 10);
    now += 11_000;
    expect(await store.addToRecord("k", "requests", 1)).toBeNull();
  });
});

describe("which store a deployment gets", () => {
  it("keeps things in this process when no Redis is named", async () => {
    expect(createStore({} as NodeJS.ProcessEnv).shared).toBe(false);
    expect(createStore({ REDIS_URL: "" } as NodeJS.ProcessEnv).shared).toBe(false);
    expect(createStore({ REDIS_URL: "   " } as NodeJS.ProcessEnv).shared).toBe(false);
  });

  it("shares them when one is named", async () => {
    // Nothing is asked of it here, so it is never connected to: this is which store was chosen.
    const store = createStore({ REDIS_URL: "redis://127.0.0.1:6399" } as NodeJS.ProcessEnv);
    expect(store.shared).toBe(true);
    await store.close();
  });
});

describe("when the shared store cannot answer", () => {
  it("falls back to this process rather than failing the request", async () => {
    // A Redis that is not there: every operation has to answer anyway.
    const store = createStore({ REDIS_URL: "redis://127.0.0.1:6399" } as NodeJS.ProcessEnv);
    try {
      await store.set("k", "v", 30);
      expect(await store.get("k")).toBe("v");

      expect(await store.take("w", 1, 60_000)).toBe(true);
      expect(await store.take("w", 1, 60_000)).toBe(false);

      const held = await store.lease("l", 1);
      expect(held).not.toBeNull();
      expect(await store.lease("l", 1)).toBeNull();

      await store.putRecord("r", { n: "1" }, 60);
      expect(await store.addToRecord("r", "n", 1)).toBe(2);
    } finally {
      await store.close();
    }
  }, 20_000);
});
