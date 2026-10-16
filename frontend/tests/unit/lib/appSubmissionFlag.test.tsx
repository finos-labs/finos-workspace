import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCanSubmitApp } from "~/lib/appSubmissionFlag";
import { useAccessStore } from "~/lib/state/access";
import { mockConfig } from "../../mocks/runtimeConfig";

function setCanSubmit(canSubmitMarketplace: boolean) {
  useAccessStore.setState({ canSubmitMarketplace });
}

describe("useCanSubmitApp", () => {
  beforeEach(() => {
    mockConfig.urls.marketplace = "";
    useAccessStore.setState({ canSubmitMarketplace: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is true when the store reports can_submit_marketplace", () => {
    setCanSubmit(true);
    const { result } = renderHook(() => useCanSubmitApp());
    expect(result.current).toBe(true);
  });

  it("is false before the store is filled", () => {
    const { result } = renderHook(() => useCanSubmitApp());
    expect(result.current).toBe(false);
  });

  it("is false when can_submit_marketplace is false", () => {
    setCanSubmit(false);
    const { result } = renderHook(() => useCanSubmitApp());
    expect(result.current).toBe(false);
  });

  it("is false when apps are listed from a remote marketplace, even when whitelisted", () => {
    setCanSubmit(true);
    mockConfig.urls.marketplace = "https://marketplace.test";
    const { result } = renderHook(() => useCanSubmitApp());
    expect(result.current).toBe(false);
  });
});
