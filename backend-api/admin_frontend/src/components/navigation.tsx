import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "utils/auth";

type ValidUrl = "/" | "/docs" | "/manageEntities" | "/login";

interface TabProps {
  name: string;
  url: ValidUrl;
}

function Tab({ name, url }: TabProps): JSX.Element {
  return (
    <NavLink
      className={({ isActive }) =>
        [
          "inline-flex h-8 items-center rounded px-3 text-xs font-medium transition-colors",
          isActive
            ? "bg-tab-bg-primary text-link-color"
            : "text-ds-text-subtitle hover:bg-general-bg-secondary hover:text-general-label-hover",
        ].join(" ")
      }
      to={url}
      end={url === "/"}
    >
      {name}
    </NavLink>
  );
}

export default function Navigation(): JSX.Element {
  const { logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = (): void => {
    logout(navigate);
  };

  return (
    <nav className="sticky top-0 z-20 border-b border-surface-divider bg-surface-header/95 backdrop-blur">
      <div className="ws-page-container py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="" className="h-6 w-auto" />
            <span className="text-sm font-semibold text-ds-text-heading">
              Admin Dashboard
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Tab name="Manage Entities" url="/manageEntities" />
            <Tab name="Docs" url="/docs" />
          </div>
          <button type="button" className="ws-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}
