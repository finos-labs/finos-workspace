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
  saveDashboardsOnExit,
  shareDashboard,
} from "~/api/dashboard.api";
import { type SharingLevel, useAccessStore } from "~/lib/state/access";
import type { Item } from "~/lib/state/app";
import { showNotificationWithRememberMe } from "~/lib/utils/toast";
import { partial } from "../mocks";
import "../../mocks/runtimeConfig";

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

    it("sends one save at a time, the next after the last one failed too", async () => {
      const replies: Array<(value: unknown) => void> = [];
      const failures: Array<(reason: unknown) => void> = [];
      vi.spyOn(apiClient, "post").mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            replies.push(resolve);
            failures.push(reject);
          }),
      );

      const first = postDashboards({ a: "DELETE" });
      const second = postDashboards({ b: "DELETE" });
      const third = postDashboards({ c: "DELETE" });
      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));

      failures[0](new Error("offline"));
      await expect(first).rejects.toThrow("offline");
      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
      expect(apiClient.post).toHaveBeenLastCalledWith("/app/dash/sync", {
        items: { b: "DELETE" },
      });

      replies[1]({ data: "second" });
      await expect(second).resolves.toBe("second");
      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));
      replies[2]({ data: "third" });
      await expect(third).resolves.toBe("third");
    });
  });

  describe("saveDashboardsOnExit", () => {
    const changed = { "some-uuid": partial<Item>({ index: "some-uuid" }) };

    async function withChanges(items: object) {
      const { diffItemsWithRemote } = await import("~/lib/utils");
      const { useAppStore } = await import("~/lib/state/app");
      const updateItemsStoredInCloud = vi.fn();
      vi.mocked(diffItemsWithRemote).mockReturnValue(changed);
      vi.mocked(useAppStore.getState).mockReturnValue(
        partial({ items, itemsStoredInCloud: {}, updateItemsStoredInCloud }),
      );
      return updateItemsStoredInCloud;
    }

    it("sends what changed in a request that outlives the page", async () => {
      const fetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetch);
      const items = { "some-uuid": {} };
      const updateItemsStoredInCloud = await withChanges(items);

      saveDashboardsOnExit();

      expect(fetch).toHaveBeenCalledWith("http://localhost:3000/app/dash/sync", {
        method: "POST",
        keepalive: true,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Client": "web",
        },
        body: JSON.stringify({ items: changed }),
      });
      await waitFor(() => expect(updateItemsStoredInCloud).toHaveBeenCalledWith(items));
      vi.unstubAllGlobals();
    });

    it("sends the same dashboards once, hidden and then gone", async () => {
      const fetch = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal("fetch", fetch);
      await withChanges({ "other-uuid": {} });

      saveDashboardsOnExit();
      saveDashboardsOnExit();

      expect(fetch).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it("sends a change too large to outlive the page as an ordinary request", async () => {
      const fetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetch);
      const { diffItemsWithRemote } = await import("~/lib/utils");
      await withChanges({ "large-uuid": {} });
      vi.mocked(diffItemsWithRemote).mockReturnValue({
        "large-uuid": partial<Item>({ index: "x".repeat(70 * 1024) }),
      });

      saveDashboardsOnExit();

      expect(fetch.mock.calls[0][1].keepalive).toBe(false);
      vi.unstubAllGlobals();
    });

    it("sends nothing when nothing changed", async () => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const { diffItemsWithRemote } = await import("~/lib/utils");
      await withChanges({ "same-uuid": {} });
      vi.mocked(diffItemsWithRemote).mockReturnValue({});

      saveDashboardsOnExit();

      expect(fetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
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
    const shared = {
      "55d809ef-19d1-4e63-8dce-ce57f66e5536": { creator: false, content: {} },
    };

    const serve = (sharing: SharingLevel) =>
      vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
        if (url === "/app/access") {
          return { data: { user_type: "User", sharing } };
        }
        if (url === "/app/dash/sync/shared") {
          return { data: { shared, entity_shared: {} } };
        }
        throw new Error(`unexpected GET ${url}`);
      });

    const sharedStore = async () => {
      const { useSharedAppStore } = await import("~/lib/state/sharedApp");
      const updateOnlySharedItems = vi.fn();
      vi.mocked(useSharedAppStore.getState).mockReturnValue(
        partial({ updateOnlySharedItems }),
      );
      return updateOnlySharedItems;
    };

    beforeEach(() => {
      useAccessStore.setState({ access: null });
    });

    it.each<SharingLevel>([
      "receive",
      "share",
    ])("loads the dashboards shared with a user whose sharing is %s", async (sharing) => {
      const updateOnlySharedItems = await sharedStore();
      serve(sharing);

      await getSharedDashboardsAndUpdate();

      expect(apiClient.get).toHaveBeenCalledWith("/app/dash/sync/shared");
      expect(updateOnlySharedItems).toHaveBeenCalledWith({
        shared,
        entityShared: {},
      });
      expect(useAccessStore.getState().access?.sharing).toBe(sharing);
    });

    it("clears shared dashboards without asking for them when the user cannot receive", async () => {
      const updateOnlySharedItems = await sharedStore();
      serve("none");

      await getSharedDashboardsAndUpdate();

      expect(apiClient.get).toHaveBeenCalledWith("/app/access");
      expect(apiClient.get).not.toHaveBeenCalledWith("/app/dash/sync/shared");
      expect(updateOnlySharedItems).toHaveBeenCalledWith({
        shared: {},
        entityShared: {},
      });
      expect(useAccessStore.getState().access?.sharing).toBe("none");
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
