/**
 * The identity values FINOS Workspace may forward to data backends, iframe widgets and custom
 * agents (X-Microsoft-Id-Token, X-Okta-Id-Token, X-Workspace-User), when the deployment
 * turns each one on. They live in page memory only: nothing here is persisted, so a
 * reload drops the ID tokens, and the provider is asked for them again without a prompt.
 *
 * Store-free on purpose: widget utilities import this module, and importing the auth
 * store there pulls the whole store graph into them.
 */
export type IdpTokens = {
  microsoftIdToken: string;
  oktaIdToken: string;
  email: string;
};

const EMPTY: IdpTokens = { microsoftIdToken: "", oktaIdToken: "", email: "" };

let current: IdpTokens = { ...EMPTY };

export function getIdpTokens(): Readonly<IdpTokens> {
  return current;
}

export function setIdpTokens(values: Partial<IdpTokens>) {
  current = { ...current, ...values };
}

export function clearIdpTokens() {
  current = { ...EMPTY };
}

/** An identity provider whose ID token the deployment may forward. */
export type IdpSignInProvider = "microsoft" | "okta";

// Not a secret: only which provider this tab signed in with, kept for this tab's reloads
const SIGN_IN_PROVIDER_KEY = "ws:sign-in-provider";

/**
 * Remembers that this tab signed in with Microsoft or Okta. After a reload, a tab whose ID
 * token cannot be fetched again without a prompt is signed out instead of calling the
 * backends that need it without one.
 */
export function rememberSignInProvider(provider: IdpSignInProvider) {
  try {
    sessionStorage.setItem(SIGN_IN_PROVIDER_KEY, provider);
  } catch {
    // Blocked storage: a reload then keeps the session without the ID token
  }
}

/** The provider this tab signed in with, when it was Microsoft or Okta. */
export function signInProviderOfThisTab(): IdpSignInProvider | null {
  try {
    const provider = sessionStorage.getItem(SIGN_IN_PROVIDER_KEY);
    return provider === "microsoft" || provider === "okta" ? provider : null;
  } catch {
    return null;
  }
}
