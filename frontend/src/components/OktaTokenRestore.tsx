import { type ReactNode, useEffect, useRef } from "react";
import { getOktaAuth, oktaLoginRequest } from "~/lib/okta-auth-config";
import { getConfig } from "~/lib/runtimeConfig";
import { useShallowAuthStore } from "~/lib/state/auth";
import {
  getIdpTokens,
  setIdpTokens,
  signInProviderOfThisTab,
} from "~/lib/state/idpTokens";

export default function OktaTokenRestore({ children }: { children: ReactNode }) {
  const { user, logout } = useShallowAuthStore((s) => ({
    user: s.user,
    logout: s.logout,
  }));
  const tried = useRef<string | null>(null);

  useEffect(() => {
    const oktaAuth = getOktaAuth();
    if (!(user && oktaAuth && getConfig().authentication.sendOktaIdToken)) return;
    if (getIdpTokens().oktaIdToken || tried.current === user.email) return;
    tried.current = user.email;

    oktaAuth.token
      .getWithoutPrompt({ scopes: oktaLoginRequest.scopes, loginHint: user.email })
      .then(({ tokens }) => {
        const idToken = tokens.idToken?.idToken;
        if (!idToken) throw new Error("Okta returned no ID token.");
        setIdpTokens({ oktaIdToken: idToken });
      })
      .catch((error) => {
        if (signInProviderOfThisTab() !== "okta") return;
        console.warn(
          "The Okta ID token could not be fetched again. Signing out.",
          error,
        );
        logout();
      });
  }, [user, logout]);

  return <>{children}</>;
}
