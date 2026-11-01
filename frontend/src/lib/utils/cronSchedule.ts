import { Cron } from "croner";
import cronstrue from "cronstrue";

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

export const CRON_JITTER_MS = 15_000;

export function getMillisecondsUntilNextCron(expression: string, from = Date.now()) {
  const nextDate = getNextCronDate(expression, new Date(from));
  if (!nextDate) return false;

  return Math.max(nextDate.getTime() - from, MIN_REFETCH_INTERVAL_MS);
}

type IntervalQuery = { state: { dataUpdatedAt: number } };
type RefetchIntervalFn<Q extends IntervalQuery> =
  | number
  | false
  | ((query: Q) => number | false | undefined);

export function resolveCronRefetchInterval<Q extends IntervalQuery>(
  refetchInterval: string | RefetchIntervalFn<Q> | null | undefined,
  fallback: RefetchIntervalFn<Q>,
): RefetchIntervalFn<Q> {
  const interval = refetchInterval ?? fallback;

  if (typeof interval !== "string") return interval;
  if (!interval.trim()) return false;

  return (query) => {
    const wait = getMillisecondsUntilNextCron(
      interval,
      query?.state?.dataUpdatedAt || Date.now(),
    );
    return wait === false ? false : wait + Math.floor(Math.random() * CRON_JITTER_MS);
  };
}
