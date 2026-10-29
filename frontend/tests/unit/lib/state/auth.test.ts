import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, setOnSessionRefused } from "~/api/api";
import {
  logout as apiLogout,
  getExternalCopilotHolders,
  getSession,
} from "~/api/auth.api";
import { useAccessStore } from "~/lib/state/access";
import { clearAgentToken, getAgentToken } from "~/lib/state/agentToken";
import { useAuthStore } from "~/lib/state/auth";
import { useCopilotStore } from "~/lib/state/copilot";
import { getIdpTokens, setIdpTokens } from "~/lib/state/idpTokens";
import { usePromptLibraryStore } from "~/lib/state/promptLibrary";
import { useSidebarStore } from "~/lib/state/sidebar";
import { useThemeStore } from "~/lib/state/theme";
import { useToastStore } from "~/lib/state/toast";
import { useUserAppsStore } from "~/lib/state/userApps";
import { useWorkspaceBridgeStore } from "~/lib/state/workspaceBridge";
import { getStorage } from "~/lib/utils/indexDB";
import { showNotification } from "~/lib/utils/toast";
import type { DisplaySettings, SessionResponse } from "~/types/auth.type";
import { mockConfig } from "../../../mocks/runtimeConfig";
import { makeAccess, makeAuthUser } from "../../factories";

vi.mock("~/api/auth.api", () => ({
  getExternalCopilotHolders: vi.fn(),
  getSession: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("~/lib/utils/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/utils/toast")>()),
  showNotification: vi.fn(),
}));

const mockClearCache = vi.fn();
vi.mock("~/lib/microsoft-auth-config", () => ({
  getMsalInstance: () => ({ clearCache: mockClearCache }),
}));

const onSessionRefused = vi.mocked(setOnSessionRefused).mock.calls[0]?.[0];

const session = (overrides: Partial<SessionResponse> = {}): SessionResponse => ({
  uuid: "user-uuid",
  email: "user@example.com",
  entity_name: "Org",
  role: "member",
  access: makeAccess({ user_type: "Developer" }),
  user: {
    first_name: "Ada",
    last_name: "Lovelace",
    display_settings: { lastVisitedPage: "/app/abc" } as DisplaySettings,
  },
  ...overrides,
});

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      showChangelog: false,
      lastVisitedPage: "/app",
      name: { first: "", last: "" },
    });
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { token: "agent-token", expires_in: 1800 },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearAgentToken();
    window.sessionStorage.clear();
    window.history.pushState(null, "", "/");
    mockConfig.authentication.identityProviders = [];
  });

  describe("lastVisitedPage and the changelog", () => {
    it("updates the last visited page", () => {
      useAuthStore.getState().updateLastVisitedPage("/app/dashboard/123");
      expect(useAuthStore.getState().lastVisitedPage).toBe("/app/dashboard/123");
    });

    it("updates the changelog flag", () => {
      useAuthStore.getState().updateShowChangelog(true);
      expect(useAuthStore.getState().showChangelog).toBe(true);
    });
  });

  describe("restoreSession", () => {
    it("asks the API for the session once and keeps the profile and access", async () => {
      vi.mocked(getSession).mockResolvedValue(session());

      const [first, second] = await Promise.all([
        useAuthStore.getState().restoreSession(),
        useAuthStore.getState().restoreSession(),
      ]);

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().user).toEqual({
        email: "user@example.com",
        entity_name: "Org",
        role: "member",
        uuid: "user-uuid",
      });
      expect(useAuthStore.getState().name).toEqual({ first: "Ada", last: "Lovelace" });
      expect(useAuthStore.getState().lastVisitedPage).toBe("/app/abc");
      expect(useAccessStore.getState().access?.user_type).toBe("Developer");
    });

    it("loads the custom agents again, with their headers kept in memory", async () => {
      const holders = [
        {
          uuid: "holder-1",
          url: "https://agents.example.com",
          headers: { "X-Api-Key": "agent-key" },
          copilots: [],
          status: "success" as const,
          enabled: true,
        },
      ];
      vi.mocked(getSession).mockResolvedValue(session());
      vi.mocked(getExternalCopilotHolders).mockImplementation(async (_, update) => {
        update?.(holders);
        return holders;
      });

      await useAuthStore.getState().restoreSession();

      await vi.waitFor(() =>
        expect(useCopilotStore.getState().externalCopilotHolders).toEqual(holders),
      );
      expect(getExternalCopilotHolders).toHaveBeenCalledTimes(1);
      useCopilotStore.getState().setExternalCopilotHolders([]);
    });

    it("reports no session when the cookie holds none", async () => {
      vi.mocked(getSession).mockResolvedValue(null);

      await expect(useAuthStore.getState().restoreSession()).resolves.toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(getExternalCopilotHolders).not.toHaveBeenCalled();
    });

    it("does not ask the API when a user is already signed in", async () => {
      useAuthStore.setState({ user: makeAuthUser() });

      await expect(useAuthStore.getState().restoreSession()).resolves.toBe(true);
      expect(getSession).not.toHaveBeenCalled();
    });
  });

  describe("when the API refuses the session", () => {
    it("signs out the user in memory", async () => {
      vi.mocked(apiLogout).mockResolvedValue({ success: true });
      useAuthStore.setState({ user: makeAuthUser() });

      onSessionRefused?.();

      await vi.waitFor(() => expect(apiLogout).toHaveBeenCalledTimes(1));
    });

    it("does nothing while nobody is signed in", () => {
      vi.mocked(apiLogout).mockClear();

      onSessionRefused?.();

      expect(apiLogout).not.toHaveBeenCalled();
    });

    it("is handed to the API client when the store loads", () => {
      expect(onSessionRefused).toBeTypeOf("function");
    });
  });

  describe("logout", () => {
    it("ends the session and wipes what the page kept", async () => {
      localStorage.clear();
      vi.mocked(apiLogout).mockResolvedValue({ success: true });
      useAuthStore.setState({ user: makeAuthUser() });
      setIdpTokens({ microsoftIdToken: "ms-id-token", email: "user@example.com" });
      await getAgentToken();
      window.sessionStorage.setItem("okta-transaction", "state");
      for (const store of [
        useThemeStore,
        useCopilotStore,
        usePromptLibraryStore,
        useSidebarStore,
        useToastStore,
        useWorkspaceBridgeStore,
      ]) {
        store.setState({});
      }
      useUserAppsStore.setState({ userApps: {} });
      await vi.waitFor(async () =>
        expect(await getStorage("user-apps-storage")).not.toBeNull(),
      );
      expect(localStorage.length).toBeGreaterThanOrEqual(6);

      await useAuthStore.getState().logout();

      expect(apiLogout).toHaveBeenCalledTimes(1);
      expect(getIdpTokens()).toEqual({
        microsoftIdToken: "",
        oktaIdToken: "",
        email: "",
      });
      expect(window.sessionStorage.length).toBe(0);
      expect(localStorage.length).toBe(0);
      expect(await getStorage("user-apps-storage")).toBeNull();
      expect(window.location.pathname).toBe("/login");

      vi.mocked(apiClient.post).mockClear();
      await getAgentToken();
      expect(apiClient.post).toHaveBeenCalledWith("/app/copilot/token");
    });

    it("does not ask the API to end a session the page never had", async () => {
      await useAuthStore.getState().logout();

      expect(apiLogout).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe("/login");
    });

    it("signs out once for concurrent calls", async () => {
      vi.mocked(apiLogout).mockResolvedValue({ success: true });
      useAuthStore.setState({ user: makeAuthUser() });

      await Promise.all([
        useAuthStore.getState().logout(),
        useAuthStore.getState().logout(),
        useAuthStore.getState().logout(),
      ]);

      expect(apiLogout).toHaveBeenCalledTimes(1);
    });

    it("keeps everything when the API could not end the session", async () => {
      vi.mocked(apiLogout).mockResolvedValue({ success: false });
      useAuthStore.setState({ user: makeAuthUser() });
      setIdpTokens({ oktaIdToken: "okta-id-token" });

      await useAuthStore.getState().logout();

      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Logout Failed" }),
      );
      expect(getIdpTokens().oktaIdToken).toBe("okta-id-token");
      expect(window.location.pathname).not.toBe("/login");
    });

    it("clears the MSAL cache when Microsoft sign-in is on", async () => {
      mockConfig.authentication.identityProviders = ["microsoft"];

      await useAuthStore.getState().logout();

      expect(mockClearCache).toHaveBeenCalledTimes(1);
    });
  });
});
