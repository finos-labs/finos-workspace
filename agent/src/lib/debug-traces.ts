/**
 * LIVE_DEBUG_TRACES prints what the model is given and answers, and every event sent to the browser, to the
 * log: whole conversations, in the clear. That is a tool for a developer's own machine. In production it
 * is ignored unless the operator also says (INES_ALLOW_DEBUG_TRACES=true) that they mean it.
 */

export function liveDebugLevel(env: Record<string, string | undefined> = process.env): number {
  const requested = Number(env.LIVE_DEBUG_TRACES ?? 0);
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  if (env.NODE_ENV === "production" && env.INES_ALLOW_DEBUG_TRACES !== "true") return 0;
  return requested;
}

/** True when LIVE_DEBUG_TRACES was asked for and is being ignored: the server says so at start. */
export function liveDebugIgnored(env: Record<string, string | undefined> = process.env): boolean {
  return Number(env.LIVE_DEBUG_TRACES ?? 0) > 0 && liveDebugLevel(env) === 0;
}
