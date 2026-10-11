/**
 * What stops one user from using more than their share, and a query from being counted twice or not at all.
 *
 * A turn (one question and its answer) is several requests when the answer needs a tool that runs in
 * the browser: the browser runs it and sends the result as the next request. Only the first request of
 * a turn is counted against the daily limit. A request that claims to continue a turn is believed only
 * while this process knows of that turn, so a client cannot skip the count by sending every request as a
 * continuation; and the turn is forgotten when the answer is given.
 *
 * A turn is also bounded in requests: a client that keeps sending continuations cannot run model calls
 * for ever under the one count it was charged. And the agent as a whole is bounded in the queries it runs
 * at once, so that when it is busy it says so (and the user can try again) instead of using all its memory.
 *
 * State is in this process: with several replicas, a continuation that reaches another replica is
 * counted as a new turn (the user is charged more, never less).
 */

const MAX_TURNS = 10_000;
const MAX_COUNTED_USERS = 10_000;

export type Admission = { ok: true; release: () => void } | { ok: false; reason: "user" | "server" };

export interface Limits {
  /** Takes one of the user's query slots (and one of the server's), or says which was full. Call `release` when the query ends. */
  admit(userId: string): Admission;
  /** The same, for a caller that only needs to know whether there was a slot. */
  acquire(userId: string): (() => void) | null;
  /** How many queries are running now, all users together. */
  running(): number;
  startTurn(chatKey: string): void;
  inTurn(chatKey: string): boolean;
  /** Counts another request of a turn that is under way; false when the turn has used all it may. */
  noteRequest(chatKey: string): boolean;
  /** Counts a helper call (a title, a rewritten prompt, ...) of the user; false when they have made all they may in a minute. */
  helperCall(userId: string): boolean;
  /** Counts a request of the user that was not a request at all (not JSON, not a question). */
  strike(userId: string): void;
  /** Whether the user has sent so many of those in the last minute that their requests are turned away unread. */
  struck(userId: string): boolean;
  endTurn(chatKey: string): void;
}

export interface LimitsOptions {
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
  now?: () => number;
}

/** How many times each user did something in the last minute, for a bounded number of users. */
function windowCounter(max: number, now: () => number) {
  const times = new Map<string, number[]>();
  function recent(userId: string): number[] {
    return (times.get(userId) ?? []).filter((when) => when > now() - 60_000);
  }
  function keep(userId: string, list: number[]): void {
    // The users who did something last are last in the Map; the ones to forget when there are too many come first.
    times.delete(userId);
    if (list.length > 0) times.set(userId, list);
    for (const user of times.keys()) {
      if (times.size <= MAX_COUNTED_USERS) break;
      times.delete(user);
    }
  }
  return {
    /** Counts one more, and says whether there was room for it. */
    take(userId: string): boolean {
      const list = recent(userId);
      const allowed = list.length < max;
      if (allowed) list.push(now());
      keep(userId, list);
      return allowed;
    },
    /** Counts one more, even past the most. */
    record(userId: string): void {
      const list = recent(userId);
      if (list.length < max) list.push(now());
      keep(userId, list);
    },
    full(userId: string): boolean {
      return recent(userId).length >= max;
    },
  };
}

export function createLimits(options: LimitsOptions): Limits {
  const { maxConcurrent, maxTotal = Infinity, maxRequestsPerTurn = 60, turnSeconds = 600, maxHelperCallsPerMinute = 60, maxInvalidPerMinute = 20, now = Date.now } = options;
  const running = new Map<string, number>();
  let runningTotal = 0;
  const turns = new Map<string, { started: number; requests: number }>(); // chat key -> the turn
  const helperCalls = windowCounter(maxHelperCallsPerMinute, now);
  const invalid = windowCounter(maxInvalidPerMinute, now);

  function purge(): void {
    const cutoff = now() - turnSeconds * 1000;
    for (const [key, turn] of turns) {
      if (turn.started < cutoff) turns.delete(key);
    }
    // Still too many: the oldest go first (a Map keeps insertion order).
    for (const key of turns.keys()) {
      if (turns.size <= MAX_TURNS) break;
      turns.delete(key);
    }
  }

  function admit(userId: string): Admission {
    if (runningTotal >= maxTotal) return { ok: false, reason: "server" };
    const count = running.get(userId) ?? 0;
    if (count >= maxConcurrent) return { ok: false, reason: "user" };
    running.set(userId, count + 1);
    runningTotal++;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        runningTotal--;
        const left = (running.get(userId) ?? 1) - 1;
        if (left <= 0) running.delete(userId);
        else running.set(userId, left);
      },
    };
  }

  return {
    admit,
    running: () => runningTotal,
    acquire(userId) {
      const admission = admit(userId);
      return admission.ok ? admission.release : null;
    },

    startTurn(chatKey) {
      turns.delete(chatKey);
      turns.set(chatKey, { started: now(), requests: 1 });
      if (turns.size > MAX_TURNS) purge();
    },

    inTurn(chatKey) {
      const turn = turns.get(chatKey);
      if (turn === undefined) return false;
      if (turn.started < now() - turnSeconds * 1000) {
        turns.delete(chatKey);
        return false;
      }
      return true;
    },

    noteRequest(chatKey) {
      const turn = turns.get(chatKey);
      if (turn === undefined) return true;
      turn.requests++;
      return turn.requests <= maxRequestsPerTurn;
    },

    endTurn(chatKey) {
      turns.delete(chatKey);
    },

    helperCall: (userId) => helperCalls.take(userId),
    strike: (userId) => void invalid.record(userId),
    struck: (userId) => invalid.full(userId),
  };
}
