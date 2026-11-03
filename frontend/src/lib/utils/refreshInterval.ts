import { REFRESH_WIDGET_INTERVAL } from "~/lib/constants";

export const REFRESH_JITTER = 0.1;

export function jitteredRefreshInterval(): number {
  return (
    REFRESH_WIDGET_INTERVAL * (1 - REFRESH_JITTER + Math.random() * 2 * REFRESH_JITTER)
  );
}
