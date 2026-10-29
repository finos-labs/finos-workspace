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

export type IdpSignInProvider = "microsoft" | "okta";

const SIGN_IN_PROVIDER_KEY = "ws:sign-in-provider";

export function rememberSignInProvider(provider: IdpSignInProvider) {
  try {
    sessionStorage.setItem(SIGN_IN_PROVIDER_KEY, provider);
  } catch {}
}

export function signInProviderOfThisTab(): IdpSignInProvider | null {
  try {
    const provider = sessionStorage.getItem(SIGN_IN_PROVIDER_KEY);
    return provider === "microsoft" || provider === "okta" ? provider : null;
  } catch {
    return null;
  }
}
