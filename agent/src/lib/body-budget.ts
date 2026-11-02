import { getHeapStatistics } from "node:v8";

export const BODY_MEMORY_FACTOR = 3;

export interface BodyBudget {
  reserve(bodyBytes: number): (() => void) | null;
  reset(): void;
  readonly held: number;
  readonly capacity: number;
}

export function createBodyBudget(capacity: number): BodyBudget {
  let held = 0;
  return {
    reserve(bodyBytes) {
      const needed = Math.ceil(Math.max(0, bodyBytes) * BODY_MEMORY_FACTOR);
      if (held > 0 && held + needed > capacity) return null;
      held += needed;
      let given = false;
      return () => {
        if (given) return;
        given = true;
        held -= needed;
      };
    },
    reset() {
      held = 0;
    },
    get held() {
      return held;
    },
    get capacity() {
      return capacity;
    },
  };
}

export const bodyBudget = createBodyBudget(Math.floor(getHeapStatistics().heap_size_limit / 2));
