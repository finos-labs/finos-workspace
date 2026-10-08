import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import { getMarketplaceBaseUrl, useListedApps } from "~/hooks/useListedApps";
import { mockConfig } from "../../mocks/runtimeConfig";

describe("getMarketplaceBaseUrl", () => {
  afterEach(() => {
    mockConfig.urls.marketplace = "";
  });

  it("is undefined without a remote marketplace (the configured backend is used)", () => {
    expect(getMarketplaceBaseUrl()).toBeUndefined();
  });

  it("is the remote marketplace when one is configured", () => {
    mockConfig.urls.marketplace = "https://marketplace.test";
    expect(getMarketplaceBaseUrl()).toBe("https://marketplace.test");
  });
});

describe("useListedApps marketplace request", () => {
  function createWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  beforeEach(() => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    mockConfig.urls.marketplace = "";
    vi.mocked(apiClient.get).mockReset();
  });

  it("requests a remote marketplace cross-origin without auth", async () => {
    mockConfig.urls.marketplace = "https://marketplace.test";

    const { result } = renderHook(() => useListedApps(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });
    expect(apiClient.get).toHaveBeenCalledWith("/marketplace/apps", {
      baseURL: "https://marketplace.test",
      headers: { authorization: "" },
    });
  });

  it("requests the configured backend with default (authed) config without a remote marketplace", async () => {
    const { result } = renderHook(() => useListedApps(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });
    expect(apiClient.get).toHaveBeenCalledWith("/marketplace/apps", undefined);
  });
});
