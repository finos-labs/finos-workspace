import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import useQueriesLeft from "~/components/AI/hooks/useQueriesLeft";
import { useAuthStore } from "~/lib/state/auth";
import { type Usage, useFeatureFlagsStore } from "~/lib/state/featureFlags";

const usage = (overrides: Partial<Usage> = {}): Usage => ({
  number_copilot_calls_day_count: 10,
  number_copilot_tokens_day_count: 0,
  total_file_upload_size_gb_count: 0,
  copilot_calls_limit: 100,
  copilot_tokens_limit: null,
  file_upload_size_limit: 50,
  ...overrides,
});

describe("useQueriesLeft", () => {
  beforeEach(() => {
    useAuthStore.setState({ openaiApiKey: "" });
  });

  it("counts the queries left against the daily limit", () => {
    useFeatureFlagsStore.setState({ usage: usage() });

    const { result } = renderHook(() => useQueriesLeft());

    expect(result.current.queriesLeft).toBe(90);
  });

  it("has no limit to report when none is set", () => {
    useFeatureFlagsStore.setState({
      usage: usage({ copilot_calls_limit: 0, copilot_tokens_limit: null }),
    });

    const { result } = renderHook(() => useQueriesLeft());

    expect(result.current.queriesLeft).toBeNull();
  });

  it("leaves no query once the daily tokens are used up", () => {
    useFeatureFlagsStore.setState({
      usage: usage({
        copilot_tokens_limit: 1000,
        number_copilot_tokens_day_count: 1200,
      }),
    });

    const { result } = renderHook(() => useQueriesLeft());

    expect(result.current.queriesLeft).toBe(0);
  });

  it("keeps counting queries while tokens remain", () => {
    useFeatureFlagsStore.setState({
      usage: usage({
        copilot_tokens_limit: 1000,
        number_copilot_tokens_day_count: 400,
      }),
    });

    const { result } = renderHook(() => useQueriesLeft());

    expect(result.current.queriesLeft).toBe(90);
  });

  it("limits by tokens alone", () => {
    useFeatureFlagsStore.setState({
      usage: usage({
        copilot_calls_limit: 0,
        copilot_tokens_limit: 1000,
        number_copilot_tokens_day_count: 1000,
      }),
    });

    const { result } = renderHook(() => useQueriesLeft());

    expect(result.current.queriesLeft).toBe(0);
  });

  it("blocks every query when the token limit is zero", () => {
    useFeatureFlagsStore.setState({
      usage: usage({ copilot_tokens_limit: 0, number_copilot_tokens_day_count: 0 }),
    });

    const { result } = renderHook(() => useQueriesLeft());

    expect(result.current.queriesLeft).toBe(0);
  });
});
