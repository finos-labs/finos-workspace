// Copyright FINOS contributors. Licensed under the Apache License, Version 2.0.
//
// The user's consent to a tool call an MCP App makes. The host asks before an
// app calls a tool that does not say it only reads, one call at a time, in the
// order the app made them.

import { useCallback, useRef, useState } from "react";

/**
 * How long a call must be on screen before the user can allow it. The second
 * click of a double-click on Allow would otherwise allow the next call, whose
 * arguments the user has not seen.
 */
export const CONSENT_ARM_MS = 500;

export type PendingCall = {
  toolName: string;
  title: string;
  args: Record<string, unknown> | undefined;
};

type Waiting = { call: PendingCall; resolve: (allowed: boolean) => void };

export function useCallConsent() {
  const queue = useRef<Waiting[]>([]);
  const shownAt = useRef(0);
  const [pending, setPending] = useState<PendingCall | null>(null);

  const showNext = useCallback(() => {
    shownAt.current = Date.now();
    setPending(queue.current[0]?.call ?? null);
  }, []);

  /** Resolves true once the user allows the call, false when they deny it. */
  const ask = useCallback(
    (call: PendingCall) =>
      new Promise<boolean>((resolve) => {
        queue.current.push({ call, resolve });
        if (queue.current.length === 1) showNext();
      }),
    [showNext],
  );

  /**
   * Answers the call on screen. The call is named, because a dialog can report
   * one dismissal twice, and the second must not answer the next call. Allow
   * counts only once the call has been on screen for CONSENT_ARM_MS; Deny always
   * counts.
   */
  const answer = useCallback(
    (call: PendingCall | null, allowed: boolean) => {
      const head = queue.current[0];
      if (!head || head.call !== call) return;
      if (allowed && Date.now() - shownAt.current < CONSENT_ARM_MS) return;
      queue.current.shift();
      head.resolve(allowed);
      showNext();
    },
    [showNext],
  );

  /** Refuses every call still waiting, for when the app closes. */
  const declineAll = useCallback(() => {
    const waiting = queue.current.splice(0);
    for (const { resolve } of waiting) resolve(false);
    setPending(null);
  }, []);

  return { pending, ask, answer, declineAll };
}
