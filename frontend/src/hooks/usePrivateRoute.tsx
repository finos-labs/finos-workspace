import { useEffect } from "react";
import { validateUser } from "~/api/auth.api";
import { useShallowAuthStore } from "~/lib/state/auth";

export function usePrivateRoute(shouldValidate = true) {
  const { user, logout } = useShallowAuthStore((state) => ({
    user: state.user,
    logout: state.logout,
  }));

  useEffect(() => {
    if (!user) {
      console.info("🚫 User is not logged in, redirecting to auth page");
      logout();
      return;
    }

    if (shouldValidate) {
      console.info("🔐 User is logged in, checking token validity");
      validateUser()
        .then((data) => {
          if (!data.success) {
            console.info("🚫 Token is invalid, redirecting to auth page");
            logout();
          }
        })
        .catch((err) => {
          console.error("🚫 Token validation failed, redirecting to auth page", err);
          logout();
        });
    }
  }, [user, shouldValidate, logout]);
}
