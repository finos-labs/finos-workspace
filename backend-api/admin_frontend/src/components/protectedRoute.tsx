import Navigation from "components/navigation";
import React, { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { type AuthStore, useAuthStore } from "utils/auth";

export default function ProtectedRoute(): JSX.Element {
  const user = useAuthStore((state: AuthStore) => state.user);
  const bootstrap = useAuthStore((state: AuthStore) => state.bootstrap);

  useEffect(() => {
    if (user === undefined) {
      bootstrap().catch(console.error);
    }
  }, [user, bootstrap]);

  if (user === undefined) {
    return <div className="min-h-screen bg-surface-page" />;
  }
  if (user === null) {
    return <Navigate to="/login" replace />;
  }
  return (
    <div className="min-h-screen bg-surface-page">
      <Navigation />
      <div className="ws-page-container">
        <Outlet />
      </div>
    </div>
  );
}
