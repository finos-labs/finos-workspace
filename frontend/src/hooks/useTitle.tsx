import { useEffect } from "react";
import { useLocation, useMatches } from "react-router-dom";
import { getConfig } from "~/lib/runtimeConfig";
import { useShallowAppStore } from "~/lib/state/app";
import { useShallowSharedAppStore } from "~/lib/state/sharedApp";

export function useGlobalTitleManager(): void {
  const location = useLocation();
  const matches = useMatches();

  const tabId = matches.find((m) => m.params?.id)?.params?.id;

  const tabName = useShallowAppStore((state) =>
    tabId ? state?.items?.[tabId]?.data?.name : undefined,
  );
  const sharedTabName = useShallowSharedAppStore((state) =>
    tabId ? state?.sharedItems?.[tabId]?.data?.name : undefined,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    const brandName = getConfig().whiteLabel?.name || "FINOS Workspace";
    let pageTitle = "";

    const path = location.pathname;

    if (path === "/login") {
      pageTitle = "Login";
    } else if (path === "/reset-password") {
      pageTitle = "Set a new password";
    } else if (path === "/signup") {
      pageTitle = "Create an account";
    } else if (path === "/signup/confirm") {
      pageTitle = "Choose your password";
    } else if (path === "/app") {
      pageTitle = "Apps";
    } else if (path.startsWith("/app/widgets")) {
      pageTitle = "Widgets Library";
    } else if (path.startsWith("/app/ai")) {
      pageTitle = "AI Library";
    } else if (path.startsWith("/app/connections")) {
      pageTitle = "Connections";
    } else if (path.startsWith("/app/settings")) {
      pageTitle = "Settings";
    } else if (path.startsWith("/app/help-documentation")) {
      pageTitle = "Help & Documentation";
    } else if (path.startsWith("/app/") && tabId) {
      pageTitle = tabName || sharedTabName || "";
    } else if (path === "/admin") {
      pageTitle = "Admin Portal";
    } else if (path === "/admin/users") {
      pageTitle = "Users | Admin";
    } else if (path === "/admin/roles") {
      pageTitle = "Roles | Admin";
    } else if (path === "/admin/apps") {
      pageTitle = "Apps | Admin";
    } else if (path === "/admin/theme-settings") {
      pageTitle = "Theme | Admin";
    } else if (path === "/admin/account") {
      pageTitle = "Account | Admin";
    }

    const fullTitle = pageTitle ? `${pageTitle} | ${brandName}` : brandName;

    if (document.title !== fullTitle) {
      document.title = fullTitle;
    }
  }, [location.pathname, tabName, sharedTabName, tabId]);
}

export default useGlobalTitleManager;
