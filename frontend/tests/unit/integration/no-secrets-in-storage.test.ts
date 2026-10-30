import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import { getAgentToken } from "~/lib/state/agentToken";
import { useAuthStore } from "~/lib/state/auth";
import { useBackendConnectorStore } from "~/lib/state/backendConnector";
import { useCopilotStore } from "~/lib/state/copilot";
import { useSharedAppStore } from "~/lib/state/sharedApp";
import { useThemeStore } from "~/lib/state/theme";
import { useUserAppsStore } from "~/lib/state/userApps";
import { getStorage } from "~/lib/utils/indexDB";
import type { LoginResponse } from "~/types/auth.type";
import { partial } from "../mocks";

const SECRETS = {
  agentToken: "SECRET-AGENT-TOKEN",
  dataBackendKey: "SECRET-DATA-BACKEND-KEY",
  widgetCopyKey: "SECRET-WIDGET-COPY-KEY",
  agentKey: "SECRET-CUSTOM-AGENT-KEY",
  sharedDashboardKey: "SECRET-SHARED-DASHBOARD-KEY",
  appKey: "SECRET-APP-KEY",
};

const credentialWidget = (key: string) => ({
  id: "widget-1",
  name: "Prices",
  endpoint: {
    url: "https://data.example.test/prices",
    method: "GET",
    headers: [{ key: "X-Api-Key", value: key }],
  },
});

function readIndexedDB(): Promise<string> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("Workspace");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("workspace")) return resolve("");
      const request = db.transaction("workspace").objectStore("workspace").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(JSON.stringify(request.result));
    };
  });
}

const readWebStorage = (storage: Storage) =>
  JSON.stringify(
    Array.from({ length: storage.length }, (_, i) => {
      const key = storage.key(i) ?? "";
      return [key, storage.getItem(key)];
    }),
  );

describe("browser storage after a session full of credentials", () => {
  beforeAll(async () => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { token: SECRETS.agentToken, expires_in: 1800 },
    });

    useAuthStore.getState().login(
      partial<LoginResponse>({
        uuid: "user-uuid",
        email: "user@example.com",
        entity_name: null,
        role: null,
        user: { first_name: "Ada", last_name: "L", display_settings: {} },
      }),
    );
    await getAgentToken();

    useBackendConnectorStore.setState({
      apiSources: [
        {
          id: "source-1",
          name: "Prices",
          url: "https://data.example.test",
          status: "success",
          endpointHeaders: [{ key: "X-Api-Key", value: SECRETS.dataBackendKey }],
          widgets: {
            prices: {
              name: "Prices",
              endpointHeaders: [{ key: "X-Api-Key", value: SECRETS.widgetCopyKey }],
            },
          },
        },
      ] as never,
    });

    useCopilotStore.setState({
      externalCopilotHolders: [
        {
          uuid: "holder-1",
          url: "https://agent.example.test",
          headers: { "X-Agent-Key": SECRETS.agentKey },
          copilots: [
            {
              id: "custom-agent",
              holderUuid: "holder-1",
              headers: { "X-Agent-Key": SECRETS.agentKey },
            },
          ],
        },
      ] as never,
    });

    useSharedAppStore.setState({
      sharedItems: {
        "shared-1": {
          index: "shared-1",
          children: [],
          data: { widgets: [credentialWidget(SECRETS.sharedDashboardKey)] },
        },
      } as never,
    });
    useUserAppsStore.setState({
      userApps: {
        "app-1": {
          uuid: "app-1",
          content: { widgets: [credentialWidget(SECRETS.appKey)] },
        },
      } as never,
    });
    useThemeStore.setState({ aiEnhancements: true });

    await vi.waitFor(async () => {
      expect(await getStorage("backend-connector")).not.toBeNull();
      expect(await getStorage("user-apps-storage")).not.toBeNull();
    });
  });

  afterAll(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each(Object.entries(SECRETS))("keeps the %s out of localStorage", (_, secret) => {
    expect(readWebStorage(localStorage)).not.toContain(secret);
  });

  it.each(
    Object.entries(SECRETS),
  )("keeps the %s out of sessionStorage", (_, secret) => {
    expect(readWebStorage(sessionStorage)).not.toContain(secret);
  });

  it.each(
    Object.entries(SECRETS),
  )("keeps the %s out of IndexedDB", async (_, secret) => {
    expect(await readIndexedDB()).not.toContain(secret);
  });

  it("still persists the non-secret parts", async () => {
    const webStorage = readWebStorage(localStorage);
    expect(webStorage).toContain("https://agent.example.test");
    expect(webStorage).toContain("shared-1");
    const indexedDB = await readIndexedDB();
    expect(indexedDB).toContain("https://data.example.test");
    expect(indexedDB).toContain("app-1");
  });

  it("persists no auth store at all", () => {
    expect(localStorage.getItem("auth-storage")).toBeNull();
  });
});
