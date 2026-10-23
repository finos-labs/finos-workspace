/**
 * What stops one user from using more than their share, and a query from being counted twice or not at all.
 *
 * A turn (one question and its answer) is several requests when the answer needs a tool that runs in
 * the browser: the browser runs it and sends the result as the next request. Only the first request of
 * a turn is counted against the daily limit. A request that claims to continue a turn is believed only
 * while the agent knows of that turn, so a client cannot skip the count by sending every request as a
 * continuation; and the turn is forgotten when the answer is given.
 *
 * A turn is also bounded in requests: a client that keeps sending continuations cannot run model calls
 * for ever under the one count it was charged. And the agent as a whole is bounded in the queries it runs
 * at once, so that when it is busy it says so (and the user can try again) instead of using all its memory.
 *
 * All of it is counted in the store (src/lib/store.ts), so with REDIS_URL set a user has one share
 * across every replica and a continuation is recognised whichever replica it reaches. Without it the
 * store keeps the counts in this process, as it always did, and a deployment should run one replica.
 *
 * `running()` is the exception and is deliberately local: it is what a shutdown waits for, and a
 * replica waits for the queries it is itself serving, not for another replica's.
 */

import type { Store } from "../lib/store.ts";

export type Admission = { ok: true; release: () => void } | { ok: false; reason: "user" | "server" };

export interface Limits {
  /** Takes one of the user's query slots (and one of the server's), or says which was full. Call `release` when the query ends. */
  admit(userId: string): Promise<Admission>;
  /** The same, for a caller that only needs to know whether there was a slot. */
  acquire(userId: string): Promise<(() => void) | null>;
  /** How many queries this replica is running now, all users together. What a shutdown waits for. */
  running(): number;
  startTurn(chatKey: string): Promise<void>;
  inTurn(chatKey: string): Promise<boolean>;
  /** Counts another request of a turn that is under way; false when the turn has used all it may. */
  noteRequest(chatKey: string): Promise<boolean>;
  /** Counts a helper call (a title, a rewritten prompt, ...) of the user; false when they have made all they may in a minute. */
  helperCall(userId: string): Promise<boolean>;
  /** Counts a request of the user that was not a request at all (not JSON, not a question). */
  strike(userId: string): Promise<void>;
  /** Whether the user has sent so many of those in the last minute that their requests are turned away unread. */
  struck(userId: string): Promise<boolean>;
  endTurn(chatKey: string): Promise<void>;
}

export interface LimitsOptions {
  store: Store;
  maxConcurrent: number;
  /** Queries the whole agent runs at once (default: no limit). */
  maxTotal?: number;
  /** Requests one turn may be made of: the first and the continuations after tools (default 60). */
  maxRequestsPerTurn?: number;
  /** How long a turn may wait for the browser to run a tool and come back (default 600). */
  turnSeconds?: number;
  /** Helper calls one user may make in a minute (default 60). */
  maxHelperCallsPerMinute?: number;
  /** Requests that are not requests (not JSON, not a question) one user may send in a minute before the rest are turned away unread (default 20). */
  maxInvalidPerMinute?: number;
}

const MINUTE = 60_000;

/** Keys, so that what is counted for one user, chat or purpose is never counted for another. */
const key = {
  userQueries: (userId: string) => `q:user:${userId}`,
  allQueries: () => "q:all",
  turn: (chatKey: string) => `turn:${chatKey}`,
  helper: (userId: string) => `helper:${userId}`,
  invalid: (userId: string) => `invalid:${userId}`,
};

export function createLimits(options: LimitsOptions): Limits {
  const {
    store,
    maxConcurrent,
    maxTotal = Infinity,
    maxRequestsPerTurn = 60,
    turnSeconds = 600,
    maxHelperCallsPerMinute = 60,
    maxInvalidPerMinute = 20,
  } = options;

  // What this replica is serving right now. Not the share, which is counted in the store: this is
  // what a shutdown waits to finish.
  let runningHere = 0;

  // A query holds a place among the whole agent's and among its user's. The agent's is taken first,
  // so that a user who is at their own limit is told that rather than taking one of the server's.
  async function admit(userId: string): Promise<Admission> {
    const everyone =
      maxTotal === Infinity ? async () => undefined : await store.lease(key.allQueries(), maxTotal);
    if (everyone === null) return { ok: false, reason: "server" };

    const mine = await store.lease(key.userQueries(userId), maxConcurrent);
    if (mine === null) {
      await everyone();
      return { ok: false, reason: "user" };
    }

    runningHere++;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        runningHere--;
        // Giving a place back is not something a caller waits for, and a place that is not given
        // back runs out by itself (see LEASE_TTL_MS).
        void mine();
        void everyone();
      },
    };
  }

  return {
    admit,
    running: () => runningHere,

    async acquire(userId) {
      const admission = await admit(userId);
      return admission.ok ? admission.release : null;
    },

    async startTurn(chatKey) {
      await store.putRecord(key.turn(chatKey), { requests: "1" }, turnSeconds);
    },

    async inTurn(chatKey) {
      // The turn runs out by itself after turnSeconds, so a record that is there is a turn under way.
      return (await store.getRecord(key.turn(chatKey))) !== null;
    },

    async noteRequest(chatKey) {
      const requests = await store.addToRecord(key.turn(chatKey), "requests", 1);
      // No turn to count against: nothing is being continued, so nothing has run out.
      if (requests === null) return true;
      return requests <= maxRequestsPerTurn;
    },

    async endTurn(chatKey) {
      await store.del(key.turn(chatKey));
    },

    helperCall: (userId) => store.take(key.helper(userId), maxHelperCallsPerMinute, MINUTE),
    strike: (userId) => store.record(key.invalid(userId), maxInvalidPerMinute, MINUTE),
    struck: (userId) => store.full(key.invalid(userId), maxInvalidPerMinute, MINUTE),
  };
}
