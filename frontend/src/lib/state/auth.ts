import { isEqual } from "lodash";
import { persist, subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { logout } from "~/api/auth.api";
import { getConfig } from "~/lib/runtimeConfig";
import type { Selector } from "~/lib/state/app";
import { useBackendConnectorStore } from "~/lib/state/backendConnector";
import { useCopilotAccessStore } from "~/lib/state/copilotAccess";
import { useMcpToolsStore } from "~/lib/state/mcpTools";
import { showNotification } from "~/lib/utils/toast";
import type { LoginResponse } from "~/types/auth.type";
import { useCopilotStore } from "./copilot";
import { useSharedAppStore } from "./sharedApp";
import { useThemeStore } from "./theme";
import { useWorkspaceBridgeStore } from "./workspaceBridge";

interface User {
  email: string;
  username: string;
  token: string;
  entity_name: null | string;
  role: null | string;
  uuid: string;
}

interface Name {
  first: string;
  last: string;
}

export interface AuthState {
  microsoftIdToken: string;
  oktaIdToken: string;
  perplexityApiKey: string;
  setPerplexityApiKey: (value: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (value: string) => void;
  setCopilotApiKeys: (params: {
    perplexityApiKey?: string;
    openaiApiKey?: string;
  }) => void;
  lastVisitedPage: string;
  updateLastVisitedPage: (value: string) => void;
  login: (data: LoginResponse) => void;
  logout: () => void;
  isFirstLogin: boolean;
  showChangelog: boolean;
  updateShowChangelog: (value: boolean) => void;
  user: User | null;
  updateUser: (user: Partial<User>) => void;
  name: Name;
  updateName: (value: Name) => void;
  promptHistory: PromptHistory[];
  updatePromptHistory: (value: PromptHistory[]) => void;
  alphaWarning: boolean;
  updateAlphaWarning: (value: boolean) => void;
}

type PromptHistory = {
  prompt: string;
  widgetId: string;
};

export const useAuthStore = createWithEqualityFn<AuthState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        microsoftIdToken: "",
        oktaIdToken: "",
        perplexityApiKey: "",
        setPerplexityApiKey: (value) => set({ perplexityApiKey: value }),
        openaiApiKey: "",
        setOpenaiApiKey: (value) => set({ openaiApiKey: value }),
        setCopilotApiKeys: ({ perplexityApiKey = "", openaiApiKey = "" }) =>
          set({ perplexityApiKey, openaiApiKey }),
        lastVisitedPage: "/app",
        updateLastVisitedPage: (value) => set({ lastVisitedPage: value }),
        showChangelog: false,
        updateShowChangelog: (value) => set({ showChangelog: value }),
        promptHistory: [],
        updatePromptHistory: (value) => set({ promptHistory: value }),
        alphaWarning: true,
        updateAlphaWarning: (value) => set({ alphaWarning: value }),
        isFirstLogin: false,
        updateName: (value) => set({ name: { ...get().name, ...value } }),
        name: { first: "", last: "" },
        login: (data: LoginResponse) => {
          const { sendMicrosoftIdToken, sendOktaIdToken } = getConfig().authentication;

          const {
            lastVisitedPage = "/app/data-connectors",
            openaiApiKey,
            perplexityApiKey,
            ...displaySettings
          } = data.user.display_settings;

          data.user.display_settings = displaySettings;

          set((state) => ({
            ...state,
            ...(sendMicrosoftIdToken && {
              microsoftIdToken: data.microsoftIdToken ?? "",
            }),
            ...(sendOktaIdToken && {
              oktaIdToken: data.oktaIdToken ?? "",
            }),
            user: {
              email: data.email,
              username: data.username,
              token: data.access_token,
              entity_name: data.entity_name,
              role: data.role,
              uuid: data.uuid,
            },
            isFirstLogin: data.is_first_login,
            showChangelog: data.show_changelog,
            lastVisitedPage,
            openaiApiKey: openaiApiKey || state.openaiApiKey,
            perplexityApiKey: perplexityApiKey || state.perplexityApiKey,
          }));

          const user = data.user;
          set({
            name: { first: user.first_name ?? "", last: user.last_name ?? "" },
          });
        },
        logout: async () => {
          const data = await logout();
          if (!data?.success) {
            return showNotification({
              message: "Logout Failed",
              description: "An error occurred while logging out. Please try again.",
              toastType: "error",
            });
          }
          useMcpToolsStore.getState().clearAllStorage();
          useCopilotAccessStore.getState().setAccess(null);
          window.sessionStorage.clear();
          useBackendConnectorStore.persist.clearStorage();
          useThemeStore.persist.clearStorage();
          useSharedAppStore.persist.clearStorage();
          useCopilotStore.persist.clearStorage();
          useAuthStore.persist.clearStorage();
          useWorkspaceBridgeStore.persist.clearStorage();
          window.history.pushState(null, "", "/login");
          window.location.reload();
        },
        user: null,
        updateUser: (user) =>
          set((state) => ({ user: { ...(state.user ?? ({} as User)), ...user } })),
      }),
      {
        name: "auth-storage",
      },
    ),
  ),
  shallow,
);

export type AuthStore = typeof useAuthStore;

export function useShallowAuthStore<T>(selector: Selector<AuthState, T>): T {
  return useAuthStore(useShallow(selector), (prev, next) => isEqual(prev, next));
}
