import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useShallowAuthStore } from "~/lib/state/auth";

export default function AuthRedirect() {
  const navigate = useNavigate();
  const { isAuthenticated, restoreSession } = useShallowAuthStore((state) => ({
    isAuthenticated: state.user !== null,
    restoreSession: state.restoreSession,
  }));

  useEffect(() => {
    if (isAuthenticated) return;
    let active = true;
    restoreSession().then((signedIn) => {
      if (active && !signedIn) navigate("/login", { replace: true });
    });
    return () => {
      active = false;
    };
  }, [isAuthenticated, navigate, restoreSession]);

  return null;
}
