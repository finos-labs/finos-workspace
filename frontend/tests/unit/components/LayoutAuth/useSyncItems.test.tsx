import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import { getApiSources } from "~/api/auth.api";
import useSyncItems from "~/components/LayoutAuth/useSyncItems";
import { useAppStore } from "~/lib/state/app";
import { useAuthStore } from "~/lib/state/auth";
import { makeAuthUser } from "../../factories";

vi.mock("~/api/auth.api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/api/auth.api")>()),
  getApiSources: vi.fn(async () => []),
}));
vi.mock("~/api/dashboard.api", () => ({
  saveDashboards: vi.fn(),
  saveDashboardsOnExit: vi.fn(),
}));
vi.mock("~/components/AI/hooks/useGetAppWidgets", () => ({
  useGetAppWidgets: vi.fn(),
}));

function renderAt(path: string) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useSyncItems(), { wrapper });
}

describe("useSyncItems after a reload", () => {
  beforeEach(() => {
    // The page's color-scheme meta, which applying the synced theme updates
    if (!document.querySelector('meta[name="color-scheme"]')) {
      const meta = document.createElement("meta");
      meta.name = "color-scheme";
      document.head.append(meta);
    }
    useAppStore.setState({ items: null } as never);
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { owned: {}, shared: {}, entity_shared: {}, file_widgets: [] },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("waits for the signed-in user before syncing", async () => {
    renderAt("/app");
    await Promise.resolve();

    expect(apiClient.get).not.toHaveBeenCalled();
  });

  // Data backend credentials are never persisted, so only this refetch restores them
  it.each([
    "/app",
    "/app/dashboard-1",
  ])("refetches the data backends on %s", async (path) => {
    useAuthStore.setState({ user: makeAuthUser() });

    renderAt(path);

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith("/app/dash/validate-and-sync"),
    );
    await waitFor(() => expect(getApiSources).toHaveBeenCalledTimes(1));
  });
});
