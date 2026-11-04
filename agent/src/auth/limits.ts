import type { Store } from "../lib/store.ts";

export type Admission = { ok: true; release: () => void } | { ok: false; reason: "user" | "server" };

export interface Limits {
  admit(userId: string): Promise<Admission>;
  acquire(userId: string): Promise<(() => void) | null>;
  running(): number;
  startTurn(chatKey: string): Promise<void>;
  inTurn(chatKey: string): Promise<boolean>;
  noteRequest(chatKey: string): Promise<boolean>;
  helperCall(userId: string): Promise<boolean>;
  strike(userId: string): Promise<void>;
  struck(userId: string): Promise<boolean>;
  endTurn(chatKey: string): Promise<void>;
}

export interface LimitsOptions {
  store: Store;
  maxConcurrent: number;
  maxTotal?: number;
  maxRequestsPerTurn?: number;
  turnSeconds?: number;
  maxHelperCallsPerMinute?: number;
  maxInvalidPerMinute?: number;
}

const MINUTE = 60_000;

const key = {
  userQueries: (userId: string) => `q:user:${userId}`,
  allQueries: () => "q:all",
  turn: (chatKey: string) => `turn:${chatKey}`,
  helper: (userId: string) => `helper:${userId}`,
  invalid: (userId: string) => `invalid:${userId}`,
};

export const TURN_SECONDS = 600;

export function createLimits(options: LimitsOptions): Limits {
  const {
    store,
    maxConcurrent,
    maxTotal = Infinity,
    maxRequestsPerTurn = 60,
    turnSeconds = TURN_SECONDS,
    maxHelperCallsPerMinute = 60,
    maxInvalidPerMinute = 20,
  } = options;

  let runningHere = 0;

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
      return (await store.getRecord(key.turn(chatKey))) !== null;
    },

    async noteRequest(chatKey) {
      const requests = await store.addToRecord(key.turn(chatKey), "requests", 1);
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
