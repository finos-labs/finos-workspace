import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import {
  deleteAllDashboards,
  deleteDashboardShare,
  getDashboardShareUsers,
  getDashboards,
  getOwnedDashboards,
  getSharedDashboardsAndUpdate,
  postDashboards,
  saveDashboards,
  shareDashboard,
} from "~/api/dashboard.api";
import { showNotificationWithRememberMe } from "~/lib/utils/toast";
import { partial } from "../mocks";

// Mock apiClient
vi.mock("~/api/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

// Mock state management functions
vi.mock("~/lib/state/app", () => ({
  useAppStore: {
    getState: vi.fn().mockReturnValue({
      items: {},
      itemsStoredInCloud: {},
      updateItemsStoredInCloud: vi.fn(),
    }),
  },
}));

vi.mock("~/lib/state/auth", () => ({
  useAuthStore: {
    getState: vi.fn().mockReturnValue({
      logout: vi.fn(),
    }),
  },
}));

// Mock useFeatureFlagsStore
vi.mock("~/lib/state/featureFlags", () => ({
  useFeatureFlagsStore: {
    getState: vi.fn().mockReturnValue({
      featureFlags: { tier: "full" },
    }),
  },
}));

// Mock useSharedAppStore
vi.mock("~/lib/state/sharedApp", () => ({
  useSharedAppStore: {
    getState: vi.fn().mockReturnValue({
      sharedItems: {},
      updateOnlySharedItems: vi.fn(),
    }),
  },
}));

vi.mock("~/lib/utils", () => ({
  diffItemsWithRemote: vi.fn().mockReturnValue({}),
  dispatchSaveState: vi.fn(),
  getValidItems: vi.fn().mockReturnValue({}),
}));

vi.mock("~/lib/utils/toast", () => ({
  showNotificationWithRememberMe: vi.fn(),
  NotificationId: { SaveDashboards: "save-dashboards" },
}));

// // Mock setup for useFeatureFlagsStore
// const mockUseFeatureFlagsStore = (tier: string) => {
//   vi.mock("~/lib/state/featureFlags", () => ({
//     useFeatureFlagsStore: vi.fn(() => ({
//       getState: vi.fn().mockReturnValue({
//         featureFlags: { tier },
//       }),
//     })),
//   }));
// };

// Test suite
describe("Dashboard API functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("postDashboards", () => {
    it("should post dashboards correctly", async () => {
      const dashboardData = { key: "DELETE" } as const;

      vi.spyOn(apiClient, "post").mockResolvedValue({ data: {} });

      await postDashboards(dashboardData);

      expect(apiClient.post).toHaveBeenCalledWith("/app/dash/sync", {
        items: dashboardData,
      });
    });
  });

  it("should get dashboards correctly", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({ data: {} });

    await getDashboards();
    expect(apiClient.get).toHaveBeenCalledWith("/app/dash/sync");
  });

  it("should handle errors when getting owned dashboards", async () => {
    vi.spyOn(apiClient, "get").mockRejectedValueOnce(new Error("Network error"));

    const data = await getOwnedDashboards();
    expect(data).toEqual({});
  });

  describe("getSharedDashboardsAndUpdate", () => {
    beforeEach(() => {
      // Clear all mocks before each test to ensure a clean state
      vi.clearAllMocks();
    });

    // The expect condition is not working. Either the mock is not working or the function is not being called.
    it("should update shared dashboards for full tier", async () => {
      const { useSharedAppStore } = await import("~/lib/state/sharedApp");
      const { useFeatureFlagsStore } = await import("~/lib/state/featureFlags");

      const updateOnlySharedItemsMock = vi.fn();
      vi.mocked(useSharedAppStore.getState).mockReturnValue(
        partial({
          updateOnlySharedItems: updateOnlySharedItemsMock,
        }),
      );

      vi.mocked(useFeatureFlagsStore.getState).mockReturnValue(
        partial({
          featureFlags: { tier: "full" },
        }),
      );

      // Mock the API call
      vi.spyOn(apiClient, "get").mockResolvedValue({
        data: {
          shared: {
            "55d809ef-19d1-4e63-8dce-ce57f66e5536": {
              creator: false,
              content: {},
            },
          },
          entity_shared: {},
        },
      });

      // Call the function
      await getSharedDashboardsAndUpdate();

      // Assert that updateOnlySharedItems was called
      expect(updateOnlySharedItemsMock).toHaveBeenCalled();
    });

    it("should not update shared dashboards for basic tier", async () => {
      const { useSharedAppStore } = await import("~/lib/state/sharedApp");
      const { useFeatureFlagsStore } = await import("~/lib/state/featureFlags");

      const updateOnlySharedItemsMock = vi.fn();
      vi.mocked(useSharedAppStore.getState).mockReturnValue(
        partial({
          updateOnlySharedItems: updateOnlySharedItemsMock,
        }),
      );

      // Mock the feature flags to be basic
      vi.mocked(useFeatureFlagsStore.getState).mockReturnValue(
        partial({
          featureFlags: { tier: "basic" },
        }),
      );

      // Call the function
      await getSharedDashboardsAndUpdate();

      // Assert that updateOnlySharedItems was not called
      expect(updateOnlySharedItemsMock).not.toHaveBeenCalled();
    });
  });

  it("should save dashboards and show notification", async () => {
    vi.spyOn(apiClient, "post").mockResolvedValue({ data: {} });
    const { diffItemsWithRemote } = await import("~/lib/utils");
    const { useAppStore } = await import("~/lib/state/app");

    vi.mocked(diffItemsWithRemote).mockReturnValue({ "some-uuid": "DELETE" });
    vi.mocked(useAppStore.getState).mockReturnValue(
      partial({
        items: { "some-uuid": {} },
        itemsStoredInCloud: {},
        updateItemsStoredInCloud: vi.fn(),
      }),
    );

    await saveDashboards({ withNotification: true });

    await waitFor(() => {
      expect(showNotificationWithRememberMe).toHaveBeenCalled();
      expect(apiClient.post).toHaveBeenCalled();
    });
  });

  it("should delete all dashboards", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValueOnce({
      data: { owned: { id1: {}, id2: {} } },
    });
    vi.spyOn(apiClient, "post").mockResolvedValue({});

    await deleteAllDashboards();
    expect(apiClient.post).toHaveBeenCalledWith("/app/dash/sync", {
      items: { id1: "DELETE", id2: "DELETE" },
    });
  });

  it("should share dashboard with emails", async () => {
    vi.spyOn(apiClient, "post").mockResolvedValue({ data: { success: true } });

    const dashboardUuid = "uuid";
    const emails = "test@example.com,another@example.com";
    await shareDashboard(dashboardUuid, emails);
    expect(apiClient.post).toHaveBeenCalledWith(`/app/dash/${dashboardUuid}/share`, {
      shares: {
        "test@example.com": "view",
        "another@example.com": "view",
      },
    });
  });

  it("should delete dashboard share for given emails", async () => {
    vi.spyOn(apiClient, "delete").mockResolvedValue({ data: {} });

    const dashboardUuid = "uuid";
    const emails = ["test@example.com", "another@example.com"];
    await deleteDashboardShare(dashboardUuid, emails);
    expect(apiClient.delete).toHaveBeenCalledWith(`/app/dash/${dashboardUuid}/share`, {
      data: { shares: emails },
    });
  });

  it("should get dashboard share users", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({ data: {} });

    const dashboardUuid = "uuid";
    await getDashboardShareUsers(dashboardUuid);
    expect(apiClient.get).toHaveBeenCalledWith(
      `/app/dash/${dashboardUuid}/shares/users`,
    );
  });
});
