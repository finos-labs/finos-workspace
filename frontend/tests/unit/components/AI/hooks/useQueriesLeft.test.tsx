import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";
import useQueriesLeft from "~/components/AI/hooks/useQueriesLeft";
import { type Usage, useAccessStore } from "~/lib/state/access";

const usage = (overrides: Partial<Usage> = {}): Usage => ({
  number_copilot_calls_day_count: 10,
  number_copilot_tokens_day_count: 0,
  total_file_upload_size_gb_count: 0,
  copilot_calls_limit: 100,
  copilot_tokens_limit: null,
  file_upload_size_limit: 50,
  ...overrides,
});

/** Renders the hook with the flags GET /app/copilot-keys answered. */
function renderQueriesLeft(hasOpenaiKey = false) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["copilot-keys"], {
    has_openai_key: hasOpenaiKey,
    has_perplexity_key: false,
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useQueriesLeft(), { wrapper });
}

describe("useQueriesLeft", () => {
  it("has no limit to report once the user saved their own OpenAI key", () => {
    useAccessStore.setState({ usage: usage({ copilot_calls_limit: 0 }) });

    const { result } = renderQueriesLeft(true);

    expect(result.current.queriesLeft).toBeNull();
  });

  it("counts the queries left against the daily limit", () => {
    useAccessStore.setState({ usage: usage() });

    const { result } = renderQueriesLeft();

    expect(result.current.queriesLeft).toBe(90);
  });

  it("has no limit to report when the user's roles set none", () => {
    useAccessStore.setState({
      usage: usage({ copilot_calls_limit: null, copilot_tokens_limit: null }),
    });

    const { result } = renderQueriesLeft();

    expect(result.current.queriesLeft).toBeNull();
  });

  it("leaves no query when the daily calls limit is zero", () => {
    useAccessStore.setState({
      usage: usage({
        copilot_calls_limit: 0,
        number_copilot_calls_day_count: 0,
        copilot_tokens_limit: null,
      }),
    });

    const { result } = renderQueriesLeft();

    expect(result.current.queriesLeft).toBe(0);
  });

  it("leaves no query once the daily tokens are used up", () => {
    useAccessStore.setState({
      usage: usage({
        copilot_tokens_limit: 1000,
        number_copilot_tokens_day_count: 1200,
      }),
    });

    const { result } = renderQueriesLeft();

    expect(result.current.queriesLeft).toBe(0);
  });

  it("keeps counting queries while tokens remain", () => {
    useAccessStore.setState({
      usage: usage({
        copilot_tokens_limit: 1000,
        number_copilot_tokens_day_count: 400,
      }),
    });

    const { result } = renderQueriesLeft();

    expect(result.current.queriesLeft).toBe(90);
  });

  it("limits by tokens alone", () => {
    useAccessStore.setState({
      usage: usage({
        copilot_calls_limit: null,
        copilot_tokens_limit: 1000,
        number_copilot_tokens_day_count: 1000,
      }),
    });

    const { result } = renderQueriesLeft();

    expect(result.current.queriesLeft).toBe(0);
  });

  it("blocks every query when the token limit is zero", () => {
    useAccessStore.setState({
      usage: usage({ copilot_tokens_limit: 0, number_copilot_tokens_day_count: 0 }),
    });

    const { result } = renderQueriesLeft();

    expect(result.current.queriesLeft).toBe(0);
  });
});
