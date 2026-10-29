export interface BoundedCacheOptions<V> {
  ttlMs: number;
  maxEntries: number;
  weigh?: (value: V) => number;
  maxWeight?: number;
  maxEntryWeight?: number;
  now?: () => number;
}

export interface BoundedCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): boolean;
  delete(key: K): boolean;
  has(key: K): boolean;
  clear(): void;
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

export function sweepEvery(cache: Pick<BoundedCache<unknown, unknown>, "sweep">, everyMs: number): void {
  const timer = setInterval(() => cache.sweep(), everyMs);
  timer.unref?.();
}
