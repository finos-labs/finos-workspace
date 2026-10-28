import axiosRetry from "axios-retry";
import { getConfig } from "~/lib/runtimeConfig";
import { canReceiveShares, useAccessStore } from "~/lib/state/access";
import { type Item, type Items, useAppStore } from "~/lib/state/app";
import { useAuthStore } from "~/lib/state/auth";
import { useSharedAppStore } from "~/lib/state/sharedApp";
import { diffItemsWithRemote, dispatchSaveState } from "~/lib/utils";
import { WORKSPACE_CLIENT, WORKSPACE_CLIENT_HEADER } from "~/lib/utils/fetch";
import { NotificationId, showNotificationWithRememberMe } from "~/lib/utils/toast";
import type { DashShared, DashSync } from "~/types/auth.type";
import { apiClient } from "./api";
import { getAccess } from "./auth.api";

axiosRetry(apiClient, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

let saving: Promise<unknown> = Promise.resolve();

export function postDashboards(dashboardData: Record<string, Item | "DELETE">) {
  const send = async () => {
    const { data } = await apiClient.post("/app/dash/sync", {
      items: dashboardData,
    });
    return data;
  };
  const sent = saving.then(send, send);
  saving = sent.catch(() => undefined);
  return sent;
}

const KEEPALIVE_BYTES = 60 * 1024;
let sentOnExit: Items | null = null;

export function saveDashboardsOnExit() {
  dispatchSaveState();
  const { items, itemsStoredInCloud, updateItemsStoredInCloud } =
    useAppStore.getState();
  if (!(items && itemsStoredInCloud) || items === sentOnExit) return;
  const diff = diffItemsWithRemote(items, itemsStoredInCloud);
  if (Object.keys(diff).length === 0) return;
  sentOnExit = items;
  const body = JSON.stringify({ items: diff });
  fetch(`${getConfig().urls.backend.replace(/\/$/, "")}/app/dash/sync`, {
    method: "POST",
    keepalive: new TextEncoder().encode(body).length <= KEEPALIVE_BYTES,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      [WORKSPACE_CLIENT_HEADER]: WORKSPACE_CLIENT,
    },
    body,
  }).then(
    (response) => {
      if (response.ok) updateItemsStoredInCloud(items);
    },
    () => undefined,
  );
}

export async function getDashboards<T extends DashSync>(): Promise<T> {
  const { data } = await apiClient.get<T>("/app/dash/sync");
  return data;
}

export async function getOwnedDashboards<T extends DashSync<"owned">>(): Promise<T> {
  const { data } = await apiClient
    .get<T>("/app/dash/sync/owned")
    .catch(() => ({ data: {} as T }));
  return data as T;
}

export async function getSharedDashboards<T extends DashShared>(): Promise<T> {
  const { data } = await apiClient
    .get<T>("/app/dash/sync/shared")
    .catch(() => ({ data: {} as T }));
  return data as T;
}

export async function getSharedDashboardsAndUpdate() {
  const access = await getAccess();
  useAccessStore.getState().setAccess(access);

  const remoteData: Partial<DashShared> = canReceiveShares(access)
    ? await getSharedDashboards()
    : {};
  useSharedAppStore.getState().updateOnlySharedItems({
    shared: remoteData.shared ?? {},
    entityShared: remoteData.entity_shared ?? {},
  });
}

type SaveDashboardsParams = {
  logout?: boolean;
  withNotification?: boolean;
  checkDiff?: boolean;
};

export async function saveDashboards(params?: SaveDashboardsParams) {
  const { withNotification = false, checkDiff = false, logout = false } = params ?? {};

  const notifyParams = {
    id: NotificationId.SaveDashboards,
    message: "Dashboards saved",
    description: "Your dashboards have been saved",
    toastType: "success",
  } as const;

  dispatchSaveState();
  const { items, itemsStoredInCloud, updateItemsStoredInCloud } =
    useAppStore.getState();

  if (!items || Object.keys(items).length === 0) return;

  getSharedDashboardsAndUpdate().catch(
    () =>
      import.meta.env.DEV && console.log("Error when trying to get shared dashboards"),
  );

  try {
    const diff = diffItemsWithRemote(items, itemsStoredInCloud);

    if (checkDiff) return Object.keys(diff).length > 0;

    if (Object.keys(diff).length > 0) {
      postDashboards(diff).then((_res) => {
        updateItemsStoredInCloud(items);
        if (withNotification) showNotificationWithRememberMe(notifyParams);
        if (logout) useAuthStore.getState().logout();
      });
      return;
    }
  } catch (_e) {
    if (logout) useAuthStore.getState().logout();
  }

  if (withNotification) showNotificationWithRememberMe(notifyParams);
  if (logout) useAuthStore.getState().logout();
}

export async function getDashboardShares(dashboardUuid: string) {
  const { data } = await apiClient.get(`/app/dash/${dashboardUuid}/shares`);
  return data;
}

export async function deleteAllDashboards() {
  const { data } = await apiClient.get("/app/dash/sync");
  const ids = Object.keys(data.owned);
  await apiClient.post("/app/dash/sync", {
    items: ids.reduce<Record<string, "DELETE">>((acc, id) => {
      acc[id] = "DELETE";
      return acc;
    }, {}),
  });
}

export async function shareDashboard(dashboardUuid: string, emails: string) {
  const emailArray = emails.split(",");

  const shares = emailArray.reduce<Record<string, "view">>((acc, email) => {
    acc[email] = "view";
    return acc;
  }, {});

  const { data } = await apiClient
    .post(`/app/dash/${dashboardUuid}/share`, {
      shares,
    })
    .catch((e) => {
      if (e?.response?.data) {
        const { data } = e.response;
        const success = data?.success ?? false;
        return { data: { success, detail: data.detail } };
      }
      return { data: { success: false, detail: "Unable to share dashboard" } };
    });

  return data;
}

export async function deleteDashboardShare(dashboardUuid: string, emails: string[]) {
  const url = `/app/dash/${dashboardUuid}/share`;

  const { data } = await apiClient.delete(url, {
    data: { shares: emails },
  });

  return data;
}

export async function getDashboardShareUsers(dashboardUuid: string) {
  const { data } = await apiClient.get(`/app/dash/${dashboardUuid}/shares/users`);
  return data;
}
