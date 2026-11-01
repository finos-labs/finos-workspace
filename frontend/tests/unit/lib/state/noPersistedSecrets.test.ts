import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetT } from "~/components/types";
import type { Item } from "~/lib/state/app";
import {
  type Copilot,
  type ExternalCopilotHolder,
  useCopilotStore,
} from "~/lib/state/copilot";
import { useSharedAppStore } from "~/lib/state/sharedApp";
import { type UserAppReturn, useUserAppsStore } from "~/lib/state/userApps";
import { getStorage } from "~/lib/utils/indexDB";
import { partial } from "../../mocks";

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const SECRET = "Bearer secret-value-123";

const widgetWithSavedCredentials = partial<WidgetT>({
  id: "w1",
  name: "Prices",
  sourceId: "src-1",
  endpoint: {
    url: "https://api.example.com/prices",
    method: "GET",
    headers: { Authorization: SECRET },
    query: { apikey: "secret-query-456" },
  } as WidgetT["endpoint"],
});

beforeEach(() => {
  localStorage.clear();
});

describe("persisted stores", () => {
  it("copilot: a custom agent's headers are never persisted, even if they were held in memory", () => {
    const holder = partial<ExternalCopilotHolder>({
      uuid: "h1",
      url: "https://agent.example.com",
      headers: { Authorization: SECRET },
      copilots: [
        partial<Copilot>({
          id: "a1",
          name: "Agent",
          headers: { "X-Key": "secret-agent-789" },
        }),
      ],
    });

    useCopilotStore.setState({
      externalCopilotHolders: [holder],
      selectedCopilot: partial<Copilot>({
        id: "a1",
        headers: { "X-Key": "secret-agent-789" },
      }),
    });

    const persisted = localStorage.getItem("copilot") ?? "";
    expect(persisted).toContain("agent.example.com");
    expect(persisted).not.toContain("secret");
    expect(useCopilotStore.getState().externalCopilotHolders[0].headers).toEqual({
      Authorization: SECRET,
    });
  });

  it("shared dashboards: widgets are written without credentials", () => {
    useSharedAppStore.setState({
      sharedItems: {
        d1: partial<Item>({
          index: "d1",
          data: partial({ name: "Shared", widgets: [widgetWithSavedCredentials] }),
        }),
      },
    });

    const persisted = localStorage.getItem("shared-app-storage") ?? "";
    expect(persisted).toContain("https://api.example.com/prices");
    expect(persisted).not.toContain("secret");
  });

  it("apps: widgets are written to IndexedDB without credentials", async () => {
    const app = partial<UserAppReturn>({
      content: partial({ name: "App", widgets: [widgetWithSavedCredentials] }),
      creator: true,
    });
    useUserAppsStore.setState({ userApps: { a1: app }, sharedUserApps: { a2: app } });

    const persisted = (await getStorage("user-apps-storage")) ?? "";
    expect(persisted).toContain("https://api.example.com/prices");
    expect(persisted).not.toContain("secret");
  });
});
