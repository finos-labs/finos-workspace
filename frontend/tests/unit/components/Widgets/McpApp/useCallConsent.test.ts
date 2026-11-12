// Copyright FINOS contributors. Licensed under the Apache License, Version 2.0.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_ARM_MS,
  useCallConsent,
} from "~/components/Widgets/McpApp/useCallConsent";

const call = (toolName: string) => ({ toolName, title: toolName, args: { id: 1 } });

// A call can be allowed only once it has been on screen for a moment.
const waitUntilArmed = () => act(() => vi.advanceTimersByTime(CONSENT_ARM_MS));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("asking the user before an app calls a tool that can change data", () => {
  it("shows the call and runs it only when the user allows it", async () => {
    const { result } = renderHook(() => useCallConsent());
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = result.current.ask(call("bookTrade"));
    });
    expect(result.current.pending).toEqual(call("bookTrade"));

    waitUntilArmed();
    act(() => result.current.answer(result.current.pending, true));
    await expect(answer).resolves.toBe(true);
    expect(result.current.pending).toBeNull();
  });

  it("refuses the call when the user denies it", async () => {
    const { result } = renderHook(() => useCallConsent());
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = result.current.ask(call("bookTrade"));
    });
    act(() => result.current.answer(result.current.pending, false));
    await expect(answer).resolves.toBe(false);
  });

  it("asks about one call at a time, in the order the app made them", async () => {
    const { result } = renderHook(() => useCallConsent());
    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = result.current.ask(call("bookTrade"));
      second = result.current.ask(call("amendTrade"));
    });
    expect(result.current.pending?.toolName).toBe("bookTrade");

    waitUntilArmed();
    act(() => result.current.answer(result.current.pending, true));
    expect(result.current.pending?.toolName).toBe("amendTrade");
    act(() => result.current.answer(result.current.pending, false));

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });

  it("does not let a second answer to one call decide the next", async () => {
    const { result } = renderHook(() => useCallConsent());
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => {
      void result.current.ask(call("bookTrade"));
      second = result.current.ask(call("amendTrade"));
    });
    const shown = result.current.pending;
    act(() => result.current.answer(shown, false));
    // A dialog can report one dismissal twice, from its button and from closing.
    act(() => result.current.answer(shown, false));
    expect(result.current.pending?.toolName).toBe("amendTrade");

    waitUntilArmed();
    act(() => result.current.answer(result.current.pending, true));
    await expect(second).resolves.toBe(true);
  });

  it("does not let a double-click allow the next call before the user has seen it", async () => {
    const { result } = renderHook(() => useCallConsent());
    let second: Promise<boolean> | undefined;
    act(() => {
      void result.current.ask(call("bookTrade"));
      second = result.current.ask(call("amendTrade"));
    });
    waitUntilArmed();
    act(() => result.current.answer(result.current.pending, true));
    // The second click of a double-click lands on the next call.
    act(() => result.current.answer(result.current.pending, true));
    expect(result.current.pending?.toolName).toBe("amendTrade");

    waitUntilArmed();
    act(() => result.current.answer(result.current.pending, true));
    await expect(second).resolves.toBe(true);
  });

  it("honours a Deny at once, however soon it comes", async () => {
    const { result } = renderHook(() => useCallConsent());
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = result.current.ask(call("bookTrade"));
    });
    act(() => result.current.answer(result.current.pending, false));
    await expect(answer).resolves.toBe(false);
    expect(result.current.pending).toBeNull();
  });

  it("refuses every call still waiting when the app closes", async () => {
    const { result } = renderHook(() => useCallConsent());
    let first: Promise<boolean> = Promise.resolve(true);
    let second: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = result.current.ask(call("bookTrade"));
      second = result.current.ask(call("amendTrade"));
    });
    act(() => result.current.declineAll());
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(result.current.pending).toBeNull();
  });
});
