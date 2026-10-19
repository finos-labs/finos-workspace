import { isEqual } from "lodash";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { setOnSessionRefused } from "~/api/api";
import { getSession, logout } from "~/api/auth.api";
import { getEnabledIdentityProviders } from "~/lib/identityProviders";
import { useAccessStore } from "~/lib/state/access";
import { clearAgentToken } from "~/lib/state/agentToken";
import type { Selector } from "~/lib/state/app";
import { useBackendConnectorStore } from "~/lib/state/backendConnector";
import { useCopilotAccessStore } from "~/lib/state/copilotAccess";
import { clearIdpTokens, setIdpTokens } from "~/lib/state/idpTokens";
import { useMcpToolsStore } from "~/lib/state/mcpTools";
import { showNotification } from "~/lib/utils/toast";
import type { LoginResponse, SessionResponse } from "~/types/auth.type";
import { refreshExternalCopilotHolders, useCopilotStore } from "./copilot";
import { usePromptLibraryStore } from "./promptLibrary";
import { useSharedAppStore } from "./sharedApp";
import { useSidebarStore } from "./sidebar";
import { useThemeStore } from "./theme";
import { useToastStore } from "./toast";
import { useUserAppsStore } from "./userApps";
import { useWorkspaceBridgeStore } from "./workspaceBridge";

interface User {
  email: string;
  entity_name: null | string;
  role: null | string;
  uuid: string;
}

interface Name {
  first: string;
  last: string;
}

/** What a sign-in (POST /app/login and the identity providers) or GET /app/session says about the user. */
type SignedInProfile = Pick<
  LoginResponse | SessionResponse,
  "uuid" | "email" | "entity_name" | "role" | "user"
> & { show_changelog?: boolean };

export interface AuthState {
  lastVisitedPage: string;
  updateLastVisitedPage: (value: string) => void;
  login: (data: SignedInProfile) => void;
  /** Takes the session GET /app/session describes into the page. */
  startSession: (session: SessionResponse) => void;
  /** Restores the signed-in user from the session cookie; true when there is one. */
  restoreSession: () => Promise<boolean>;
  logout: () => Promise<void>;
  showChangelog: boolean;
  updateShowChangelog: (value: boolean) => void;
  user: User | null;
  name: Name;
}

// Empties every persisted store, awaited so the page reloads only once they are gone
async function clearPersistedStores() {
  const stores = [
    useBackendConnectorStore,
    useThemeStore,
    useSharedAppStore,
    useCopilotStore,
    usePromptLibraryStore,
    useSidebarStore,
    useToastStore,
    useUserAppsStore,
    useWorkspaceBridgeStore,
  ];
  await Promise.all(
    stores.map(async (store) => {
      const { name, storage } = store.persist.getOptions();
      if (name && storage) await storage.removeItem(name);
    }),
  );
}

// MSAL keeps its cache in page memory; clear it too, in case anything outlives the reload
async function clearMicrosoftCache() {
  if (!getEnabledIdentityProviders().includes("microsoft")) return;
  const { getMsalInstance } = await import("~/lib/microsoft-auth-config");
  await getMsalInstance().clearCache();
}

/**
 * Ends the session (when the page has one) and wipes what the page kept: in-memory
 * credentials, the persisted stores, sessionStorage and the MSAL cache. Then reloads on
 * the login page, which drops everything else held in memory.
 */
async function signOut(signedIn: boolean) {
  if (signedIn) {
    const data = await logout();
    if (!data.success) {
      showNotification({
        message: "Logout Failed",
        description: "An error occurred while logging out. Please try again.",
        toastType: "error",
      });
      return;
    }
  }
  clearAgentToken();
  clearIdpTokens();
  useMcpToolsStore.getState().clearAllStorage();
  useCopilotAccessStore.getState().setAccess(null);
  window.sessionStorage.clear();
  await Promise.all([
    clearPersistedStores(),
    clearMicrosoftCache().catch((error) =>
      console.error("Could not clear the Microsoft sign-in cache:", error),
    ),
  ]);
  window.history.pushState(null, "", "/login");
  window.location.reload();
}

let restoring: Promise<boolean> | null = null;
let signingOut: Promise<void> | null = null;

/**
 * Who is signed in. The session itself is an HttpOnly cookie the page never sees, so this
 * holds the profile only, in memory: after a reload restoreSession asks the API again.
 */
export const useAuthStore = createWithEqualityFn<AuthState>()(
  subscribeWithSelector((set, get) => ({
    lastVisitedPage: "/app",
    updateLastVisitedPage: (value) => set({ lastVisitedPage: value }),
    showChangelog: false,
    updateShowChangelog: (value) => set({ showChangelog: value }),
    name: { first: "", last: "" },
    login: (data) => {
      const { lastVisitedPage = "/app", ...displaySettings } =
        data.user.display_settings ?? {};
      data.user.display_settings = displaySettings;

      setIdpTokens({ email: data.email });
      set({
        user: {
          email: data.email,
          entity_name: data.entity_name,
          role: data.role,
          uuid: data.uuid,
        },
        showChangelog: data.show_changelog ?? false,
        lastVisitedPage,
        name: { first: data.user.first_name ?? "", last: data.user.last_name ?? "" },
      });
    },
    startSession: (session) => {
      get().login(session);
      useAccessStore
        .getState()
        .setAccessAndUsage(session.access, session.usage ?? null);
      // The custom agents' headers are never persisted: load them again
      refreshExternalCopilotHolders().catch((error) =>
        console.error("Could not load the custom agents:", error),
      );
    },
    restoreSession: () => {
      if (get().user) return Promise.resolve(true);
      restoring ??= getSession()
        .then((session) => {
          if (!session) return false;
          get().startSession(session);
          return true;
        })
        .finally(() => {
          restoring = null;
        });
      return restoring;
    },
    logout: () => {
      // Concurrent calls (several refused requests at once) share one sign-out
      signingOut ??= signOut(get().user !== null).finally(() => {
        signingOut = null;
      });
      return signingOut;
    },
    user: null,
  })),
  shallow,
);

// The API refused the session: sign out the user in memory. While no user is in memory a
// 401 says nothing about a session.
setOnSessionRefused(() => {
  const { user, logout } = useAuthStore.getState();
  if (user) logout();
});

export function useShallowAuthStore<T>(selector: Selector<AuthState, T>): T {
  return useAuthStore(useShallow(selector), (prev, next) => isEqual(prev, next));
}
