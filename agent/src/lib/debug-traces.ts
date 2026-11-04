export function liveDebugLevel(env: Record<string, string | undefined> = process.env): number {
  const requested = Number(env.LIVE_DEBUG_TRACES ?? 0);
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  if (env.NODE_ENV === "production" && env.AGENT_ALLOW_DEBUG_TRACES !== "true") return 0;
  return requested;
}

export function liveDebugIgnored(env: Record<string, string | undefined> = process.env): boolean {
  return Number(env.LIVE_DEBUG_TRACES ?? 0) > 0 && liveDebugLevel(env) === 0;
}
