import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { validateUser } from "~/api/auth.api";
import { useShallowAuthStore } from "~/lib/state/auth";

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
