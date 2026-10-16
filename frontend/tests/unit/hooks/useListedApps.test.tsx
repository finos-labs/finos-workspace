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

  const fetchMock = vi.fn(async () => Response.json([]));

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    mockConfig.urls.marketplace = "";
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  /** The one request the hook made: its URL and init. */
  async function listingRequest() {
    const { result } = renderHook(() => useListedApps(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return { url, init, headers: new Headers(init.headers) };
  }

  it("asks the API for its public listing without Workspace credentials", async () => {
    const { url, init, headers } = await listingRequest();

    expect(url).toBe("http://localhost:3000/marketplace/apps");
    expect(init.credentials).toBe("omit");
    expect(headers.get("X-Workspace-Client")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("asks a remote marketplace by its own base URL, without credentials too", async () => {
    mockConfig.urls.marketplace = "https://marketplace.test";

    const { url, init } = await listingRequest();

    expect(url).toBe("https://marketplace.test/marketplace/apps");
    expect(init.credentials).toBe("omit");
  });

  it("fails the query when the listing is refused", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    const { result } = renderHook(() => useListedApps(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
  });
});
