import type { NavigateFunction } from "react-router-dom";
import { apiLogout, fetchSession, type User } from "utils/requests";
import { create } from "zustand";

/**
 * Who is signed in, kept in memory only. The session itself is the API's HttpOnly
 * cookie, so a reload asks the API again (GET /session).
 */
export interface AuthStore {
  /** undefined until GET /session has answered, null when signed out. */
  user: User | null | undefined;
  bootstrap: () => Promise<void>;
  login: (data: User, navigate: NavigateFunction) => void;
  logout: (navigate: NavigateFunction) => Promise<void>;
}

export const useAuthStore = create<AuthStore>()((set, get) => ({
  bootstrap: async () => {
    try {
      set({ user: await fetchSession() });
    } catch (error) {
      console.error("Could not reach the API to check the session.", error);
      set({ user: null });
    }
  },
  login: (data, navigate) => {
    set({ user: data });
    navigate("/", { replace: true });
  },
  logout: async (navigate) => {
    if (get().user) {
      try {
        await apiLogout();
      } catch (error) {
        console.error("Server sign-out failed; clearing the local session anyway.", error);
      }
    }
    set({ user: null });
    navigate("/login", { replace: true });
  },
  user: undefined,
}));
