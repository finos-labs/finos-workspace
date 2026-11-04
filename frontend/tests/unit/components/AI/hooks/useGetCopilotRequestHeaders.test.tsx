import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useGetCopilotRequestHeaders } from "~/components/AI/hooks/useGetCopilotRequestHeaders";
import { useCopilotStore } from "~/lib/state/copilot";
import { clearUserEmail, setUserEmail } from "~/lib/state/userEmail";
import { mockConfig } from "../../../../mocks/runtimeConfig";

function getHeaders(traceId?: string) {
  const { result } = renderHook(() => useGetCopilotRequestHeaders());
  return result.current(traceId);
}

describe("useGetCopilotRequestHeaders", () => {
  afterEach(() => {
    clearUserEmail();
    mockConfig.authentication.sendUserEmailAsHeader = false;
    useCopilotStore.setState({ externalCopilotHolders: [] });
  });

  it("names the content type and the trace id and nothing else", () => {
    expect(getHeaders("trace-1")).toEqual({
      "Content-Type": "application/json",
      "X-Trace-Id": "trace-1",
    });
  });

  it("falls back to the current chat as the trace id", () => {
    const { result } = renderHook(() => useGetCopilotRequestHeaders());
    expect(result.current()["X-Trace-Id"]).toBe(
      useCopilotStore.getState().getCurrentChat().uuid,
    );
  });

  it("holds no agent credential and no identity: the API adds them on its side", () => {
    mockConfig.authentication.sendUserEmailAsHeader = true;
    setUserEmail("user@example.com");
    useCopilotStore.setState({
      externalCopilotHolders: [
        { uuid: "holder-1", url: "https://agent.test", headerNames: ["X-Agent-Key"] },
      ],
    });

    expect(Object.keys(getHeaders("trace-1")).sort()).toEqual([
      "Content-Type",
      "X-Trace-Id",
    ]);
  });
});
