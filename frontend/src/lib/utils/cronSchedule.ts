import { Cron } from "croner";
import cronstrue from "cronstrue";

// Floor for React Query refetch intervals: if the next cron boundary has just
// passed within the same tick, returning 0 would cause a tight refetch loop.
const MIN_REFETCH_INTERVAL_MS = 1000;

function parseCron(expression: string): Cron | null {
  try {
    return new Cron(expression);
  } catch {
    return null;
  }
}

export function isValidCronExpression(expression: string) {
  return parseCron(expression) !== null;
}

export function describeCronExpression(expression: string) {
  try {
    return cronstrue
      .toString(expression)
      .replace(/\b0(\d:\d{2}) (AM|PM)\b/g, "$1$2")
      .replace(/\b(\d{1,2}:\d{2}) (AM|PM)\b/g, "$1$2");
  } catch {
    return null;
  }
}

export function getNextCronDate(expression: string, from = new Date()) {
  return parseCron(expression)?.nextRun(from) ?? null;
}

export function getPreviousCronDate(expression: string, from = new Date()) {
  return parseCron(expression)?.previousRuns(1, from)[0] ?? null;
}

export function getMillisecondsUntilNextCron(expression: string, from = Date.now()) {
  const nextDate = getNextCronDate(expression, new Date(from));
  if (!nextDate) return false;

  return Math.max(nextDate.getTime() - from, MIN_REFETCH_INTERVAL_MS);
}

/** The queries a refetch interval is for: what it needs is when each was last updated. */
type IntervalQuery = { state: { dataUpdatedAt: number } };
type RefetchIntervalFn<Q extends IntervalQuery> =
  | number
  | false
  | ((query: Q) => number | false | undefined);

/**
 * Normalize a widget's refetch config into a value React Query's `refetchInterval` accepts.
 * - number / false / function → passed through unchanged
 * - null / undefined → falls back to `fallback`
 * - cron string → returns a function that resolves to the ms until the next cron boundary
 *   (or `false` if the string is empty/invalid, which disables refetching)
 */
export function resolveCronRefetchInterval<Q extends IntervalQuery>(
  refetchInterval: string | RefetchIntervalFn<Q> | null | undefined,
  fallback: RefetchIntervalFn<Q>,
): RefetchIntervalFn<Q> {
  const interval = refetchInterval ?? fallback;

  if (typeof interval !== "string") return interval;
  if (!interval.trim()) return false;

  return (query) =>
    getMillisecondsUntilNextCron(interval, query?.state?.dataUpdatedAt || Date.now());
}
