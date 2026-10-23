import { OktaAuth, type OktaAuthOptions } from "@okta/okta-auth-js";
import { getConfig } from "./runtimeConfig";

let _oktaAuth: OktaAuth | null = null;
let _initialized = false;

export function getOktaAuth(): OktaAuth | null {
  if (!_initialized) {
    _initialized = true;
    const cfg = getConfig();
    const clientId = cfg.authProviders.oktaClientId ?? "";
    const oktaDomain = cfg.authProviders.oktaDomain ?? "";

    if (oktaDomain) {
      const oktaAuthConfig: OktaAuthOptions = {
        clientId,
        issuer: `${oktaDomain}`,
        redirectUri: window.location.origin,
        scopes: ["openid", "profile", "email"],
        pkce: true,
        tokenManager: {
          storage: "memory",
        },
      };
      try {
        _oktaAuth = new OktaAuth(oktaAuthConfig);
      } catch (error) {
        console.error(
          "Okta sign-in is disabled: the Okta issuer URL is not valid.",
          error,
        );
      }
    }
  }
  return _oktaAuth;
}

export const oktaLoginRequest = {
  scopes: ["openid", "profile", "email"],
  prompt: "select_account",
};
