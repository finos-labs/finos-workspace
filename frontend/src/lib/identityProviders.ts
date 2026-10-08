import { getConfig } from "./runtimeConfig";

export type IdentityProvidersAvailable = "google" | "microsoft" | "okta";

export function getEnabledIdentityProviders(): IdentityProvidersAvailable[] {
  const providers = new Set(getConfig().authentication.identityProviders);
  return Array.from(providers).filter(
    (p): p is IdentityProvidersAvailable =>
      p === "google" || p === "microsoft" || p === "okta",
  );
}
