import { getConfig } from "./runtimeConfig";
import { IDENTITY_PROVIDERS } from "./runtimeConfigSchema";

type IdentityProvidersAvailable = (typeof IDENTITY_PROVIDERS)[number];

export function getEnabledIdentityProviders(): IdentityProvidersAvailable[] {
  const providers = new Set(getConfig().authentication.identityProviders);
  return Array.from(providers).filter((p): p is IdentityProvidersAvailable =>
    (IDENTITY_PROVIDERS as readonly string[]).includes(p),
  );
}
