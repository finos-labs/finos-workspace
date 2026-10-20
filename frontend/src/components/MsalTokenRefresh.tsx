import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { getConfig } from "~/lib/runtimeConfig";
import { useShallowAuthStore } from "~/lib/state/auth";
import {
  getIdpTokens,
  setIdpTokens,
  signInProviderOfThisTab,
} from "~/lib/state/idpTokens";

const SCOPES = ["User.Read"];

/**
 * Keeps the Microsoft ID token in page memory fresh while the MSAL account is known. MSAL
 * keeps its cache in memory, so after a reload there is no account: when the deployment
 * forwards the ID token, Microsoft is asked for it again without a prompt. A tab that
 * signed in with Microsoft and cannot get it back is signed out, so its backends are
 * never called without it.
 */
export default function MsalTokenRefresh({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const authStore = useShallowAuthStore((s) => ({
    user: s.user,
    logout: s.logout,
  }));
  const [refreshTick, setRefreshTick] = useState(0);
  // The silent sign-in is tried once per user: a failure must not loop
  const silentSignInTried = useRef<string | null>(null);

  const restoreAfterReload = useCallback(async () => {
    const { user, logout } = authStore;
    if (getIdpTokens().microsoftIdToken) return logout();
    if (!(user && getConfig().authentication.sendMicrosoftIdToken)) return;
    if (silentSignInTried.current === user.email) return;
    silentSignInTried.current = user.email;

    try {
      const res = await instance.ssoSilent({ scopes: SCOPES, loginHint: user.email });
      // The account found now takes over the refreshes below
      instance.setActiveAccount(res.account);
      setIdpTokens({ microsoftIdToken: res.idToken });
    } catch (error) {
      if (signInProviderOfThisTab() !== "microsoft") return;
      console.warn(
        "The Microsoft ID token could not be fetched again. Signing out.",
        error,
      );
      logout();
    }
  }, [instance, authStore]);

  const checkTokenExpiration = useCallback(async () => {
    const { user, logout } = authStore;
    // Prefer the account selected at sign-in; fall back to matching the backend email
    const currentAccount =
      instance.getActiveAccount() ??
      accounts.find((acc) => acc.username.toLowerCase() === user?.email.toLowerCase());
    if (!currentAccount) return restoreAfterReload();

    const tokenRequest = {
      account: currentAccount,
      scopes: SCOPES,
      forceRefresh: true, // Forces to refresh token
      refreshTokenExpirationOffsetSeconds: 7200, // 2 hours
    };

    try {
      const res = await instance.acquireTokenSilent(tokenRequest);
      // Keeps the active-account pointer fresh, and adopts accounts matched
      // via the email fallback
      instance.setActiveAccount(res.account);
      if (getConfig().authentication.sendMicrosoftIdToken) {
        setIdpTokens({ microsoftIdToken: res.idToken });
      }
      const exp = (res.idTokenClaims as { exp?: number } | undefined)?.exp;
      if (typeof exp !== "number") return;
      const expiresIn = exp * 1000 - Date.now();

      // Set a timeout to refresh the token 10% before it expires
      setTimeout(() => setRefreshTick((prev) => prev + 1), expiresIn * 0.9);
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        console.log("Token expired or interaction required. Logging out.");
        logout();
      } else {
        console.error("Error acquiring token silently:", e);
      }
    }
  }, [accounts, instance, authStore, restoreAfterReload]);

  useEffect(() => {
    if (inProgress !== "none") return; // Wait until MSAL is done initializing
    checkTokenExpiration();
  }, [accounts, instance, refreshTick, inProgress, authStore.user?.email]);

  return <>{children}</>;
}
