import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useShallowAuthStore } from "~/lib/state/auth";

export default function HomePage() {
  const user = useShallowAuthStore((state) => state.user);
  const navigate = useNavigate();
  useEffect(() => {
    navigate(user ? "/app" : "/login", { replace: true });
  }, [user, navigate]);
  return null;
}
