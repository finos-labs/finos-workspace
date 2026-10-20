import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { validateUser } from "~/api/auth.api";
import { useShallowAuthStore } from "~/lib/state/auth";

/**
 * Keeps a page for signed-in users. With nobody in memory (a reload) it restores the
 * session from the cookie, and sends the visitor to the login page when there is none,
 * without asking the API to end a session the page never had.
 */
export function usePrivateRoute(shouldValidate = true) {
  const navigate = useNavigate();
  const { user, logout, restoreSession } = useShallowAuthStore((state) => ({
    user: state.user,
    logout: state.logout,
    restoreSession: state.restoreSession,
  }));

  useEffect(() => {
    if (!user) {
      let active = true;
      restoreSession().then((signedIn) => {
        if (active && !signedIn) navigate("/login", { replace: true });
      });
      return () => {
        active = false;
      };
    }

    if (shouldValidate) {
      validateUser()
        .then((data) => {
          if (!data.success) logout();
        })
        .catch((err) => {
          console.error("Session validation failed, signing out", err);
          logout();
        });
    }
  }, [user, shouldValidate, logout, restoreSession, navigate]);
}
