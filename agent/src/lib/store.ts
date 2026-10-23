/**
 * Where the agent keeps what outlives one request: in Redis when there is one, in this process when
 * there is not.
 *
 * A turn is several requests (the browser runs a tool and comes back), and what the agent remembers
 * between them decides what the next one may do: who the caller is, how much of their quota is left,
 * and whether the turn they claim to continue is real. Kept in one process, all of that is right only
 * while there is one process. A second replica gives the same user their quota again, and counts a
 * continuation as a new turn.
 *
 * So each of those lives behind this interface. With REDIS_URL set they are shared and the answers
 * are the same whichever replica a request reaches. Without it they fall back to bounded structures
 * in this process, which is what a single-replica deployment and every test gets, with the same
 * behaviour as before.
 *
 * Redis is not in the way of serving: every operation that fails falls back to the process-local
 * answer rather than failing the request, because a cache that is down must not take the agent with
 * it. A quota is then enforced per replica until Redis comes back, which is looser than intended but
 * never looser than having no limit at all.
 *
 * A chat's tables and widget data are the exception: they are kept in Redis alone (`sharedOnly()`), never in a
 * process's memory. Without Redis, or while it cannot answer, they are not kept, and the widget is fetched again.
 */

import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { getLogger } from "./logger.ts";
import { metrics } from "./metrics.ts";

const logger = getLogger(["app", "store"]);

/** How long a lease lives if the process holding it dies without giving it back. */
export const LEASE_TTL_MS = 10 * 60 * 1000;

export interface Store {
  /** Whether this store is shared between replicas. The status route says so; nothing else branches on it. */
  readonly shared: boolean;

  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;

  /** Counts one more in the last `windowMs`, if fewer than `max` are there. Says whether there was room. */
  take(key: string, max: number, windowMs: number): Promise<boolean>;
  /** Counts one more in the last `windowMs`, stopping at `max` (what is past it is not worth remembering). */
  record(key: string, max: number, windowMs: number): Promise<void>;
  /** Whether `max` have happened in the last `windowMs`. */
  full(key: string, max: number, windowMs: number): Promise<boolean>;

  /**
   * Takes one of `max` places held under `key`, or null when they are all taken. The place is given
   * back by the returned function, and by itself after `ttlMs` if the process holding it stops.
   */
  lease(key: string, max: number, ttlMs?: number): Promise<(() => Promise<void>) | null>;

  /** Sets the fields of a record, replacing what was there, and gives it `ttlSeconds` to live. */
  putRecord(key: string, fields: Record<string, string>, ttlSeconds: number): Promise<void>;
  /** A record's fields, or null when there is none. */
  getRecord(key: string): Promise<Record<string, string> | null>;
  /** Adds to one number of a record. Null when there is no record to add to. */
  addToRecord(key: string, field: string, by: number): Promise<number | null>;

  /**
   * This store in Redis alone: what Redis cannot keep is not kept, and an operation it cannot answer fails
   * instead of being answered from this process. Null when there is no Redis. For what is never held in a
   * process's memory: a chat's tables and widget data (agent/row-cache.ts).
   */
  sharedOnly(): Store | null;

  close(): Promise<void>;
}

/* ───────────────────────── in this process ───────────────────────── */

/** How many keys of each kind are kept before the ones used longest ago are forgotten. */
const MAX_LOCAL_KEYS = 10_000;

function bounded<V>(): Map<string, V> {
  return new Map<string, V>();
}

/** The most recently used stay: a Map keeps insertion order, and every write puts the key back at the end. */
function keepBounded(map: Map<string, unknown>, max = MAX_LOCAL_KEYS): void {
  for (const key of map.keys()) {
    if (map.size <= max) break;
    map.delete(key);
  }
}

export function createLocalStore(now: () => number = Date.now): Store {
  const values = bounded<{ value: string; expires: number }>();
  const windows = bounded<number[]>();
  const leases = bounded<number[]>();
  const records = bounded<{ fields: Record<string, string>; expires: number }>();

  const live = (key: string, windowMs: number): number[] => {
    const kept = (windows.get(key) ?? []).filter((at) => at > now() - windowMs);
    windows.delete(key);
    if (kept.length > 0) windows.set(key, kept);
    keepBounded(windows);
    return kept;
  };

  return {
    shared: false,
    sharedOnly: () => null,

    async get(key) {
      const found = values.get(key);
      if (!found) return null;
      if (found.expires <= now()) {
        values.delete(key);
        return null;
      }
      return found.value;
    },
    async set(key, value, ttlSeconds) {
      values.delete(key);
      values.set(key, { value, expires: now() + ttlSeconds * 1000 });
      keepBounded(values);
    },
    // Redis has one keyspace and DEL removes whatever is under the key, whatever its kind. These maps
    // are an implementation detail of this store, so deleting has to reach all of them or the two
    // stores would not behave the same (a turn ended here but not there, for one).
    async del(key) {
      values.delete(key);
      records.delete(key);
      windows.delete(key);
      leases.delete(key);
    },

    async take(key, max, windowMs) {
      const kept = live(key, windowMs);
      if (kept.length >= max) return false;
      kept.push(now());
      windows.set(key, kept);
      return true;
    },
    async record(key, max, windowMs) {
      const kept = live(key, windowMs);
      if (kept.length < max) {
        kept.push(now());
        windows.set(key, kept);
      }
    },
    async full(key, max, windowMs) {
      return live(key, windowMs).length >= max;
    },

    async lease(key, max, ttlMs = LEASE_TTL_MS) {
      const held = (leases.get(key) ?? []).filter((at) => at > now() - ttlMs);
      if (held.length >= max) {
        leases.set(key, held);
        return null;
      }
      const taken = now();
      held.push(taken);
      leases.delete(key);
      leases.set(key, held);
      keepBounded(leases);
      let given = false;
      return async () => {
        if (given) return;
        given = true;
        const current = leases.get(key) ?? [];
        const at = current.indexOf(taken);
        if (at !== -1) current.splice(at, 1);
        if (current.length === 0) leases.delete(key);
      };
    },

    async putRecord(key, fields, ttlSeconds) {
      records.delete(key);
      records.set(key, { fields: { ...fields }, expires: now() + ttlSeconds * 1000 });
      keepBounded(records);
    },
    async getRecord(key) {
      const found = records.get(key);
      if (!found) return null;
      if (found.expires <= now()) {
        records.delete(key);
        return null;
      }
      return { ...found.fields };
    },
    async addToRecord(key, field, by) {
      const found = records.get(key);
      if (!found || found.expires <= now()) {
        records.delete(key);
        return null;
      }
      const next = Number(found.fields[field] ?? 0) + by;
      found.fields[field] = String(next);
      return next;
    },

    async close() {
      values.clear();
      windows.clear();
      leases.clear();
      records.clear();
    },
  };
}

/* ───────────────────────── shared, in Redis ───────────────────────── */

// Each of these is read-modify-write, and two replicas doing one at the same time must not both be
// told there was room. Redis runs a script to the end before it runs anything else, so the whole of
// each is one step.
const TAKE = `
  local now, window, max = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
  local held = redis.call('ZCARD', KEYS[1])
  if held >= max then
    redis.call('PEXPIRE', KEYS[1], window)
    return 0
  end
  redis.call('ZADD', KEYS[1], now, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], window)
  return 1`;

const FULL = `
  local now, window = tonumber(ARGV[1]), tonumber(ARGV[2])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
  return redis.call('ZCARD', KEYS[1])`;

/** `prefix` keeps the agent's keys apart from anything else that uses the same Redis. */
const PREFIX = "ines:";

export function createRedisStore(url: string, now: () => number = Date.now): Store {
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  client.on("error", (error) => {
    metrics.storeErrors.inc({ op: "connection" });
    logger.warn("Redis said: {message}", { message: error instanceof Error ? error.message : String(error) });
  });
  client.on("connect", () => logger.info("Connected to Redis: what the agent keeps is shared between replicas"));

  const key = (k: string) => `${PREFIX}${k}`;

  /**
   * The store over this connection. With `local`, an operation Redis cannot answer is answered from this
   * process; without it, the operation fails.
   */
  function over(local: Store | null): Omit<Store, "sharedOnly"> {
    /** The shared answer, or the process-local one when Redis cannot give it and there is a process-local one. */
    async function shared<T>(op: string, ask: () => Promise<T>, fallback: (local: Store) => Promise<T>): Promise<T> {
      try {
        return await ask();
      } catch (error) {
        metrics.storeErrors.inc({ op });
        const message = error instanceof Error ? error.message : String(error);
        if (!local) {
          logger.warn("Redis could not {op}: {message}", { op, message });
          throw error;
        }
        logger.warn("Redis could not {op}, answering from this process: {message}", { op, message });
        return fallback(local);
      }
    }

    return {
      shared: true,

      get: (k) => shared("get", () => client.get(key(k)), (l) => l.get(k)),
      set: (k, value, ttlSeconds) =>
        shared("set", async () => void (await client.set(key(k), value, "EX", Math.max(1, Math.ceil(ttlSeconds)))), (l) =>
          l.set(k, value, ttlSeconds),
        ),
      del: (k) => shared("del", async () => void (await client.del(key(k))), (l) => l.del(k)),

      take: (k, max, windowMs) =>
        shared(
          "take",
          async () =>
            (await client.eval(TAKE, 1, key(k), String(now()), String(windowMs), String(max), randomUUID())) === 1,
          (l) => l.take(k, max, windowMs),
        ),
      record: (k, max, windowMs) =>
        shared(
          "record",
          async () => void (await client.eval(TAKE, 1, key(k), String(now()), String(windowMs), String(max), randomUUID())),
          (l) => l.record(k, max, windowMs),
        ),
      full: (k, max, windowMs) =>
        shared(
          "full",
          async () => Number(await client.eval(FULL, 1, key(k), String(now()), String(windowMs))) >= max,
          (l) => l.full(k, max, windowMs),
        ),

      async lease(k, max, ttlMs = LEASE_TTL_MS) {
        const member = randomUUID();
        const got = await shared(
          "lease",
          async () =>
            (await client.eval(TAKE, 1, key(k), String(now()), String(ttlMs), String(max), member)) === 1,
          // Redis is down: this replica keeps its own count rather than letting everything through.
          async (l) => (await l.lease(k, max, ttlMs)) !== null,
        );
        if (!got) return null;
        let given = false;
        return async () => {
          if (given) return;
          given = true;
          await shared("release", async () => void (await client.zrem(key(k), member)), async () => undefined);
        };
      },

      putRecord: (k, fields, ttlSeconds) =>
        shared(
          "putRecord",
          async () => {
            await client
              .multi()
              .del(key(k))
              .hset(key(k), fields)
              .expire(key(k), Math.max(1, Math.ceil(ttlSeconds)))
              .exec();
          },
          (l) => l.putRecord(k, fields, ttlSeconds),
        ),
      getRecord: (k) =>
        shared(
          "getRecord",
          async () => {
            const found = await client.hgetall(key(k));
            return found && Object.keys(found).length > 0 ? found : null;
          },
          (l) => l.getRecord(k),
        ),
      addToRecord: (k, field, by) =>
        shared(
          "addToRecord",
          async () => {
            // Only where there is a record: HINCRBY on a key that is gone would make one that never expires.
            if ((await client.exists(key(k))) === 0) return null;
            return await client.hincrby(key(k), field, by);
          },
          (l) => l.addToRecord(k, field, by),
        ),

      async close() {
        await local?.close();
        client.disconnect();
      },
    };
  }

  const onlyRedis: Store = { ...over(null), sharedOnly: () => onlyRedis };
  return { ...over(createLocalStore(now)), sharedOnly: () => onlyRedis };
}

/** The store this deployment uses: shared when REDIS_URL names one. */
export function createStore(env: NodeJS.ProcessEnv = process.env, now: () => number = Date.now): Store {
  const url = (env.REDIS_URL ?? "").trim();
  if (!url) {
    logger.info("No REDIS_URL: what the agent keeps lives in this process, so run one replica of it; a chat's tables are not kept");
    return createLocalStore(now);
  }
  return createRedisStore(url, now);
}
