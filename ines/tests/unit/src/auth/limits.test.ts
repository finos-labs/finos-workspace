import { describe, it, expect } from "bun:test";
import { createLimits } from "../../../../src/auth/limits";

describe("concurrent queries", () => {
  it("lets a user run up to the limit and no more, and frees a slot when a query ends", () => {
    const limits = createLimits({ maxConcurrent: 2 });
    const first = limits.acquire("alice");
    const second = limits.acquire("alice");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(limits.acquire("alice")).toBeNull();
    first!();
    expect(limits.acquire("alice")).not.toBeNull();
  });

  it("counts each user on their own", () => {
    const limits = createLimits({ maxConcurrent: 1 });
    expect(limits.acquire("alice")).not.toBeNull();
    expect(limits.acquire("bob")).not.toBeNull();
    expect(limits.acquire("alice")).toBeNull();
  });

  it("frees a slot only once however often it is released", () => {
    const limits = createLimits({ maxConcurrent: 1 });
    const release = limits.acquire("alice")!;
    release();
    release();
    const again = limits.acquire("alice");
    expect(again).not.toBeNull();
    expect(limits.acquire("alice")).toBeNull();
  });
});

describe("the agent as a whole", () => {
  it("runs only so many queries at once, says which limit was reached, and frees a place when one ends", () => {
    const limits = createLimits({ maxConcurrent: 5, maxTotal: 2 });
    const a = limits.admit("alice");
    const b = limits.admit("bob");
    expect(a.ok && b.ok).toBe(true);
    expect(limits.admit("carol")).toEqual({ ok: false, reason: "server" });
    if (a.ok) a.release();
    expect(limits.admit("carol").ok).toBe(true);
  });

  it("says a user's own limit before the agent's, when it is the user's that is full", () => {
    const limits = createLimits({ maxConcurrent: 1, maxTotal: 10 });
    expect(limits.admit("alice").ok).toBe(true);
    expect(limits.admit("alice")).toEqual({ ok: false, reason: "user" });
  });

  it("counts a place once however often it is released", () => {
    const limits = createLimits({ maxConcurrent: 5, maxTotal: 1 });
    const a = limits.admit("alice");
    if (a.ok) {
      a.release();
      a.release();
    }
    expect(limits.admit("bob").ok).toBe(true);
    expect(limits.admit("carol").ok).toBe(false);
  });
});

describe("requests of a turn", () => {
  it("allows a turn the requests it may have, and no more", () => {
    const limits = createLimits({ maxConcurrent: 5, maxRequestsPerTurn: 3 });
    limits.startTurn("alice:c1"); // request 1
    expect(limits.noteRequest("alice:c1")).toBe(true); // 2
    expect(limits.noteRequest("alice:c1")).toBe(true); // 3
    expect(limits.noteRequest("alice:c1")).toBe(false); // 4
  });

  it("starts the count again with a new turn", () => {
    const limits = createLimits({ maxConcurrent: 5, maxRequestsPerTurn: 2 });
    limits.startTurn("k");
    limits.noteRequest("k");
    expect(limits.noteRequest("k")).toBe(false);
    limits.startTurn("k");
    expect(limits.noteRequest("k")).toBe(true);
  });

  it("has nothing to say about a turn it does not know", () => {
    expect(createLimits({ maxConcurrent: 1 }).noteRequest("nobody")).toBe(true);
  });
});

describe("turns", () => {
  it("knows a turn that began, until it ends", () => {
    const limits = createLimits({ maxConcurrent: 1 });
    expect(limits.inTurn("alice:chat-1")).toBe(false);
    limits.startTurn("alice:chat-1");
    expect(limits.inTurn("alice:chat-1")).toBe(true);
    expect(limits.inTurn("bob:chat-1")).toBe(false);
    limits.endTurn("alice:chat-1");
    expect(limits.inTurn("alice:chat-1")).toBe(false);
  });

  it("forgets a turn that was left waiting for too long", () => {
    let now = 1_000_000;
    const limits = createLimits({ maxConcurrent: 1, turnSeconds: 600, now: () => now });
    limits.startTurn("alice:chat-1");
    now += 599_000;
    expect(limits.inTurn("alice:chat-1")).toBe(true);
    now += 2_000;
    expect(limits.inTurn("alice:chat-1")).toBe(false);
  });

  it("starting a turn again starts its time again", () => {
    let now = 0;
    const limits = createLimits({ maxConcurrent: 1, turnSeconds: 10, now: () => now });
    limits.startTurn("k");
    now += 8_000;
    limits.startTurn("k");
    now += 8_000;
    expect(limits.inTurn("k")).toBe(true);
  });
});

describe("helper calls", () => {
  it("are so many in a minute for each user, and are allowed again as the minute passes", () => {
    let now = 1_000_000;
    const limits = createLimits({ maxConcurrent: 1, maxHelperCallsPerMinute: 3, now: () => now });
    expect([1, 2, 3, 4].map(() => limits.helperCall("alice"))).toEqual([true, true, true, false]);
    expect(limits.helperCall("bob")).toBe(true);
    now += 59_000;
    expect(limits.helperCall("alice")).toBe(false);
    now += 2_000;
    expect(limits.helperCall("alice")).toBe(true);
  });

  it("do not count the call that was refused, so that a user who keeps trying is let in when the minute is over", () => {
    let now = 0;
    const limits = createLimits({ maxConcurrent: 1, maxHelperCallsPerMinute: 1, now: () => now });
    expect(limits.helperCall("alice")).toBe(true);
    for (let i = 0; i < 100; i++) {
      now += 500;
      limits.helperCall("alice");
    }
    now = 60_001;
    expect(limits.helperCall("alice")).toBe(true);
  });

  it("are kept for a bounded number of users", () => {
    const limits = createLimits({ maxConcurrent: 1, maxHelperCallsPerMinute: 1 });
    for (let i = 0; i < 25_000; i++) limits.helperCall(`user-${i}`);
    // The first users were forgotten, so they may call again; the last were not.
    expect(limits.helperCall("user-0")).toBe(true);
    expect(limits.helperCall("user-24999")).toBe(false);
  });
});

describe("requests that are not requests", () => {
  it("turn a user's requests away once there are so many in a minute, and let them in again as the minute passes", () => {
    let now = 1_000_000;
    const limits = createLimits({ maxConcurrent: 1, maxInvalidPerMinute: 3, now: () => now });
    expect(limits.struck("alice")).toBe(false);
    for (let i = 0; i < 3; i++) limits.strike("alice");
    expect(limits.struck("alice")).toBe(true);
    expect(limits.struck("bob")).toBe(false);
    now += 59_000;
    expect(limits.struck("alice")).toBe(true);
    now += 2_000;
    expect(limits.struck("alice")).toBe(false);
  });

  it("are counted apart from the helper calls", () => {
    const limits = createLimits({ maxConcurrent: 1, maxInvalidPerMinute: 1, maxHelperCallsPerMinute: 5 });
    limits.strike("alice");
    expect(limits.struck("alice")).toBe(true);
    expect(limits.helperCall("alice")).toBe(true);
  });

  it("do not go on being counted once they are turned away, so that the minute is a minute from the last that counted", () => {
    let now = 0;
    const limits = createLimits({ maxConcurrent: 1, maxInvalidPerMinute: 2, now: () => now });
    limits.strike("alice");
    limits.strike("alice");
    for (let i = 0; i < 100; i++) {
      now += 500;
      limits.strike("alice"); // sent anyway: not read, and not counted again
    }
    now = 60_001;
    expect(limits.struck("alice")).toBe(false);
  });
});
