import {
  configFromEnv,
  type RuntimeConfig,
  RuntimeConfigSchema,
} from "./runtimeConfigSchema";

export type { RuntimeConfig } from "./runtimeConfigSchema";
export { parseBool, parseStringArray } from "./runtimeConfigSchema";

declare global {
  interface Window {
    __APP_CONFIG__?: unknown;
  }
}

let _config: RuntimeConfig | null = null;

function initConfig(): RuntimeConfig {
  let config: RuntimeConfig;

  if (typeof window !== "undefined" && window.__APP_CONFIG__) {
    const raw = window.__APP_CONFIG__;
    const result = RuntimeConfigSchema.safeParse(raw);
    if (result.success) {
      config = result.data;
    } else {
      console.error(
        "[runtimeConfig] window.__APP_CONFIG__ failed Zod validation. " +
          "Falling back to env vars (which may be empty in production). " +
          "Check that config.js matches the expected schema.",
      );
      console.error("[runtimeConfig] Raw config:", raw);
      console.error("[runtimeConfig] Validation errors:", result.error.format());
      config = configFromEnv(import.meta.env);
    }
  } else {
    config = configFromEnv(import.meta.env);
  }

  return config;
}

export function getConfig(): RuntimeConfig {
  if (!_config) {
    _config = initConfig();
    if (!_config.urls.backend)
      console.warn("[runtimeConfig] urls.backend is empty — API calls will fail");
    if (!_config.urls.ai)
      console.warn("[runtimeConfig] urls.ai is empty — AI/copilot features will fail");
    if (
      !_config.authProviders.googleClientId &&
      !_config.authProviders.azureClientId &&
      !_config.authProviders.oktaDomain &&
      !_config.authentication.allowEmailLogin
    ) {
      console.warn(
        "[runtimeConfig] No auth providers configured and email login is disabled — users will not be able to sign in",
      );
    }
  }
  return _config;
}

export function _resetConfig(): void {
  _config = null;
}
