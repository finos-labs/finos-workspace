import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { getLogger } from "./logger.ts";
import { metrics } from "./metrics.ts";

const logger = getLogger(["app", "store"]);

export const LEASE_TTL_MS = 10 * 60 * 1000;

export interface Store {
  readonly shared: boolean;

  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;

  take(key: string, max: number, windowMs: number): Promise<boolean>;
  record(key: string, max: number, windowMs: number): Promise<void>;
  full(key: string, max: number, windowMs: number): Promise<boolean>;

  lease(key: string, max: number, ttlMs?: number): Promise<(() => Promise<void>) | null>;

  putRecord(key: string, fields: Record<string, string>, ttlSeconds: number): Promise<void>;
  getRecord(key: string): Promise<Record<string, string> | null>;
  addToRecord(key: string, field: string, by: number): Promise<number | null>;

  sharedOnly(): Store | null;

  close(): Promise<void>;
}


const MAX_LOCAL_KEYS = 10_000;

function bounded<V>(): Map<string, V> {
  return new Map<string, V>();
}

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

const PREFIX = "agent:";

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

  function over(local: Store | null): Omit<Store, "sharedOnly"> {
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

export function createStore(env: NodeJS.ProcessEnv = process.env, now: () => number = Date.now): Store {
  const url = (env.REDIS_URL ?? "").trim();
  if (!url) {
    logger.info("No REDIS_URL: what the agent keeps lives in this process, so run one replica of it; a chat's tables are not kept");
    return createLocalStore(now);
  }
  return createRedisStore(url, now);
}
