/**
 * A cache that cannot grow without limit: entries expire, the oldest go first when there are too many,
 * and what is held is weighed so that a few very large entries cannot use all the memory.
 *
 * The caches of this process hold what users' requests put in them, so every one of them is one of these:
 * a cache with only a time to live frees an entry only when somebody asks for that very key again.
 */

export interface BoundedCacheOptions<V> {
  /** How long an entry is kept from when it was set. */
  ttlMs: number;
  maxEntries: number;
  /** The cost of an entry (its rows, its characters). Without it every entry costs 1. */
  weigh?: (value: V) => number;
  /** The most that all entries together may cost. Without it only `maxEntries` limits the cache. */
  maxWeight?: number;
  /** An entry that costs more than this is not kept at all. Default: `maxWeight`. */
  maxEntryWeight?: number;
  now?: () => number;
}

export interface BoundedCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): boolean;
  delete(key: K): boolean;
  has(key: K): boolean;
  clear(): void;
  /** Drops what has expired; returns how many entries went. Called by every `set`, and on a timer. */
  sweep(): number;
  readonly size: number;
  readonly weight: number;
}

interface Slot<V> {
  value: V;
  weight: number;
  expires: number;
}

export function createBoundedCache<K, V>(options: BoundedCacheOptions<V>): BoundedCache<K, V> {
  const { ttlMs, maxEntries, weigh = () => 1, maxWeight = Infinity, now = Date.now } = options;
  const maxEntryWeight = options.maxEntryWeight ?? maxWeight;
  // A Map keeps insertion order, so the first key is the one set (or used) longest ago.
  const slots = new Map<K, Slot<V>>();
  let total = 0;

  function drop(key: K): boolean {
    const slot = slots.get(key);
    if (!slot) return false;
    slots.delete(key);
    total -= slot.weight;
    return true;
  }

  function sweep(): number {
    const cutoff = now();
    let dropped = 0;
    for (const [key, slot] of slots) {
      if (slot.expires <= cutoff && drop(key)) dropped++;
    }
    return dropped;
  }

  return {
    get(key) {
      const slot = slots.get(key);
      if (!slot) return undefined;
      if (slot.expires <= now()) {
        drop(key);
        return undefined;
      }
      // Used: it is now the newest.
      slots.delete(key);
      slots.set(key, slot);
      return slot.value;
    },

    set(key, value) {
      drop(key);
      const weight = Math.max(0, weigh(value));
      if (weight > maxEntryWeight) return false;
      sweep();
      slots.set(key, { value, weight, expires: now() + ttlMs });
      total += weight;
      while (slots.size > maxEntries || total > maxWeight) {
        const oldest = slots.keys().next();
        if (oldest.done) break;
        drop(oldest.value);
      }
      return slots.has(key);
    },

    delete: drop,
    has(key) {
      const slot = slots.get(key);
      return slot !== undefined && slot.expires > now();
    },
    clear() {
      slots.clear();
      total = 0;
    },
    sweep,
    get size() {
      return slots.size;
    },
    get weight() {
      return total;
    },
  };
}

/** Runs `sweep` every `everyMs` for as long as the process lives, without keeping it alive. */
export function sweepEvery(cache: Pick<BoundedCache<unknown, unknown>, "sweep">, everyMs: number): void {
  const timer = setInterval(() => cache.sweep(), everyMs);
  timer.unref?.();
}
