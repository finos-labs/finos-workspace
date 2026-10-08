import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useShallowAuthStore } from "~/lib/state/auth";

/** Sends a visitor who is not signed in to the login page. */
export default function AuthRedirect() {
  const navigate = useNavigate();
  const isAuthenticated = useShallowAuthStore((state) => state.user !== null);

  useEffect(() => {
    if (!isAuthenticated) navigate("/login", { replace: true });
  }, [isAuthenticated, navigate]);

  return null;
}
