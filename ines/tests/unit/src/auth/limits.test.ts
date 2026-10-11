import { describe, it, expect } from "bun:test";
import { createLimits, type LimitsOptions } from "../../../../src/auth/limits";
import { createLocalStore } from "../../../../src/lib/store";

/** Limits over a store that keeps its counts in this process, with time the test moves. */
function limitsWith(options: Omit<LimitsOptions, "store">, now?: () => number) {
  return createLimits({ store: createLocalStore(now), ...options });
}

describe("concurrent queries", () => {
  it("lets a user run up to the limit and no more, and frees a slot when a query ends", async () => {
    const limits = limitsWith({ maxConcurrent: 2 });
    const first = await limits.acquire("alice");
    const second = await limits.acquire("alice");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await limits.acquire("alice")).toBeNull();
    first!();
    expect(await limits.acquire("alice")).not.toBeNull();
  });

  it("counts each user on their own", async () => {
    const limits = limitsWith({ maxConcurrent: 1 });
    expect(await limits.acquire("alice")).not.toBeNull();
    expect(await limits.acquire("bob")).not.toBeNull();
    expect(await limits.acquire("alice")).toBeNull();
  });

  it("frees a slot only once however often it is released", async () => {
    const limits = limitsWith({ maxConcurrent: 1 });
    const release = (await limits.acquire("alice"))!;
    release();
    release();
    const again = await limits.acquire("alice");
    expect(again).not.toBeNull();
    expect(await limits.acquire("alice")).toBeNull();
  });
});

describe("the agent as a whole", () => {
  it("runs only so many queries at once, says which limit was reached, and frees a place when one ends", async () => {
    const limits = limitsWith({ maxConcurrent: 5, maxTotal: 2 });
    const a = await limits.admit("alice");
    const b = await limits.admit("bob");
    expect(a.ok && b.ok).toBe(true);
    expect(await limits.admit("carol")).toEqual({ ok: false, reason: "server" });
    if (a.ok) a.release();
    expect((await limits.admit("carol")).ok).toBe(true);
  });

  it("says a user's own limit before the agent's, when it is the user's that is full", async () => {
    const limits = limitsWith({ maxConcurrent: 1, maxTotal: 10 });
    expect((await limits.admit("alice")).ok).toBe(true);
    expect(await limits.admit("alice")).toEqual({ ok: false, reason: "user" });
  });

  // A user who is at their own limit must not go on holding one of the agent's places.
  it("gives the agent's place back when it is the user's limit that refuses the query", async () => {
    const limits = limitsWith({ maxConcurrent: 1, maxTotal: 2 });
    const alice = await limits.admit("alice");
    expect(alice.ok).toBe(true);
    expect(await limits.admit("alice")).toEqual({ ok: false, reason: "user" });

    // One place of the two is Alice's; the refused query gave the other back, so Bob and then Carol fit.
    expect((await limits.admit("bob")).ok).toBe(true);
    expect(await limits.admit("carol")).toEqual({ ok: false, reason: "server" });
  });

  it("counts a place once however often it is released", async () => {
    const limits = limitsWith({ maxConcurrent: 5, maxTotal: 1 });
    const a = await limits.admit("alice");
    if (a.ok) {
      a.release();
      a.release();
    }
    expect((await limits.admit("bob")).ok).toBe(true);
    expect((await limits.admit("carol")).ok).toBe(false);
  });

  // A shutdown waits for the queries this replica is serving, not for another replica's.
  it("counts what this replica is running, which is what a shutdown waits for", async () => {
    const limits = limitsWith({ maxConcurrent: 5, maxTotal: 5 });
    expect(limits.running()).toBe(0);
    const a = await limits.admit("alice");
    const b = await limits.admit("bob");
    expect(limits.running()).toBe(2);
    if (a.ok) a.release();
    expect(limits.running()).toBe(1);
    if (b.ok) b.release();
    expect(limits.running()).toBe(0);
  });
});

describe("requests of a turn", () => {
  it("allows a turn the requests it may have, and no more", async () => {
    const limits = limitsWith({ maxConcurrent: 5, maxRequestsPerTurn: 3 });
    await limits.startTurn("alice:c1"); // request 1
    expect(await limits.noteRequest("alice:c1")).toBe(true); // 2
    expect(await limits.noteRequest("alice:c1")).toBe(true); // 3
    expect(await limits.noteRequest("alice:c1")).toBe(false); // 4
  });

  it("starts the count again with a new turn", async () => {
    const limits = limitsWith({ maxConcurrent: 5, maxRequestsPerTurn: 2 });
    await limits.startTurn("k");
    await limits.noteRequest("k");
    expect(await limits.noteRequest("k")).toBe(false);
    await limits.startTurn("k");
    expect(await limits.noteRequest("k")).toBe(true);
  });

  it("has nothing to say about a turn it does not know", async () => {
    expect(await limitsWith({ maxConcurrent: 1 }).noteRequest("nobody")).toBe(true);
  });
});

describe("turns", () => {
  it("knows a turn that began, until it ends", async () => {
    const limits = limitsWith({ maxConcurrent: 1 });
    expect(await limits.inTurn("alice:chat-1")).toBe(false);
    await limits.startTurn("alice:chat-1");
    expect(await limits.inTurn("alice:chat-1")).toBe(true);
    expect(await limits.inTurn("bob:chat-1")).toBe(false);
    await limits.endTurn("alice:chat-1");
    expect(await limits.inTurn("alice:chat-1")).toBe(false);
  });

  it("forgets a turn that was left waiting for too long", async () => {
    let now = 1_000_000;
    const limits = limitsWith({ maxConcurrent: 1, turnSeconds: 600 }, () => now);
    await limits.startTurn("alice:chat-1");
    now += 599_000;
    expect(await limits.inTurn("alice:chat-1")).toBe(true);
    now += 2_000;
    expect(await limits.inTurn("alice:chat-1")).toBe(false);
  });

  it("starting a turn again starts its time again", async () => {
    let now = 0;
    const limits = limitsWith({ maxConcurrent: 1, turnSeconds: 10 }, () => now);
    await limits.startTurn("k");
    now += 8_000;
    await limits.startTurn("k");
    now += 8_000;
    expect(await limits.inTurn("k")).toBe(true);
  });
});

describe("helper calls", () => {
  it("are so many in a minute for each user, and are allowed again as the minute passes", async () => {
    let now = 1_000_000;
    const limits = limitsWith({ maxConcurrent: 1, maxHelperCallsPerMinute: 3 }, () => now);
    const calls = [];
    for (let i = 0; i < 4; i++) calls.push(await limits.helperCall("alice"));
    expect(calls).toEqual([true, true, true, false]);
    expect(await limits.helperCall("bob")).toBe(true);
    now += 59_000;
    expect(await limits.helperCall("alice")).toBe(false);
    now += 2_000;
    expect(await limits.helperCall("alice")).toBe(true);
  });

  it("do not count the call that was refused, so that a user who keeps trying is let in when the minute is over", async () => {
    let now = 0;
    const limits = limitsWith({ maxConcurrent: 1, maxHelperCallsPerMinute: 1 }, () => now);
    expect(await limits.helperCall("alice")).toBe(true);
    for (let i = 0; i < 100; i++) {
      now += 500;
      await limits.helperCall("alice");
    }
    now = 60_001;
    expect(await limits.helperCall("alice")).toBe(true);
  });

  it("are kept for a bounded number of users", async () => {
    const limits = limitsWith({ maxConcurrent: 1, maxHelperCallsPerMinute: 1 });
    for (let i = 0; i < 25_000; i++) await limits.helperCall(`user-${i}`);
    // The first users were forgotten, so they may call again; the last were not.
    expect(await limits.helperCall("user-0")).toBe(true);
    expect(await limits.helperCall("user-24999")).toBe(false);
  });
});

describe("requests that are not requests", () => {
  it("turn a user's requests away once there are so many in a minute, and let them in again as the minute passes", async () => {
    let now = 1_000_000;
    const limits = limitsWith({ maxConcurrent: 1, maxInvalidPerMinute: 3 }, () => now);
    expect(await limits.struck("alice")).toBe(false);
    for (let i = 0; i < 3; i++) await limits.strike("alice");
    expect(await limits.struck("alice")).toBe(true);
    expect(await limits.struck("bob")).toBe(false);
    now += 59_000;
    expect(await limits.struck("alice")).toBe(true);
    now += 2_000;
    expect(await limits.struck("alice")).toBe(false);
  });

  it("are counted apart from the helper calls", async () => {
    const limits = limitsWith({ maxConcurrent: 1, maxInvalidPerMinute: 1, maxHelperCallsPerMinute: 5 });
    await limits.strike("alice");
    expect(await limits.struck("alice")).toBe(true);
    expect(await limits.helperCall("alice")).toBe(true);
  });

  it("do not go on being counted once they are turned away, so that the minute is a minute from the last that counted", async () => {
    let now = 0;
    const limits = limitsWith({ maxConcurrent: 1, maxInvalidPerMinute: 2 }, () => now);
    await limits.strike("alice");
    await limits.strike("alice");
    for (let i = 0; i < 100; i++) {
      now += 500;
      await limits.strike("alice"); // sent anyway: not read, and not counted again
    }
    now = 60_001;
    expect(await limits.struck("alice")).toBe(false);
  });
});
