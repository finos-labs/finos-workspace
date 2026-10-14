/**
 * Runtime Config Schema — single source of truth for config shape and defaults.
 *
 * Imported by both the app (`runtimeConfig.ts`) and the build (`vite.config.ts`).
 * Boolean, string-array and JSON fields use z.preprocess so raw env-var strings
 * ("true"/"false", comma-separated, JSON) are coerced automatically.
 */
import { z } from "zod";

// ── Coercion helpers (private) ─────────────────────────────────────────

function coerceBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

function coerceStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) {
    return v
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return undefined;
}

// ── Public coercion helpers (re-exported by runtimeConfig.ts) ──────────

export function parseBool(value: unknown, fallback: boolean): boolean {
  return coerceBool(value) ?? fallback;
}

export function parseStringArray(value: unknown): string[] {
  return coerceStringArray(value) ?? [];
}

// ── Schema field builders ──────────────────────────────────────────────

const boolField = (defaultVal: boolean) =>
  z.preprocess(coerceBool, z.boolean().default(defaultVal));

const strArrayField = (defaultVal: string[] = []) =>
  z.preprocess(coerceStringArray, z.array(z.string()).default(defaultVal));

// ── Schema ─────────────────────────────────────────────────────────────

export const RuntimeConfigSchema = z.object({
  urls: z.object({
    backend: z.string().default(""),
    ai: z.string().default(""),
    /** A remote marketplace to list apps from. Empty: this deployment's own backend is the marketplace. */
    marketplace: z.string().default(""),
  }),
  authentication: z.object({
    allowEmailLogin: boolField(true),
    identityProviders: strArrayField([]),
    sendMicrosoftIdToken: boolField(false),
    sendOktaIdToken: boolField(false),
    sendUserEmailAsHeader: boolField(false),
  }),
  authProviders: z.object({
    googleClientId: z.string().default(""),
    azureClientId: z.string().default(""),
    azureTenantId: z.string().default(""),
    oktaClientId: z.string().default(""),
    oktaDomain: z.string().default(""),
  }),
  copilot: z.object({
    enabled: boolField(false),
    defaultCopilot: boolField(true),
    documentationLinks: boolField(true),
    webSearch: boolField(true),
    secFilings: boolField(false),
    jinaAi: boolField(true),
    aiEnhancements: boolField(true),
    saveSkillFromChat: boolField(false),
    showCustomKey: boolField(true),
  }),
  ui: z.object({
    showCompanionMode: boolField(false),
    showMinimizeWidget: boolField(true),
    showExternalDocLinks: boolField(true),
    showHelpDocumentation: boolField(true),
    showChangelog: boolField(true),
    showCopilotSwitcher: boolField(true),
    showRemoveFromOrg: boolField(true),
    defaultTheme: z.enum(["light", "dark"]).default("dark"),
    showMarketplace: boolField(true),
  }),
  data: z.object({
    allowHtmlJsExecution: boolField(false),
  }),
  links: z.object({
    /** Where the documentation lives. Empty: the links to it are hidden. */
    docsUrl: z.string().default(""),
  }),
  contact: z.object({
    /** Where users are sent for help. Empty: no address is shown. */
    supportEmail: z.string().default(""),
  }),
  whiteLabel: z.object({
    name: z.string().default("Workspace"),
    shortName: z.string().default("Workspace"),
    loginImage: z.string().default("/assets/images/brand_lettering.svg"),
    loginImageDark: z.string().default("/assets/images/brand_lettering_light.svg"),
    leftSidebarLogo: z.string().default(""),
    leftSidebarLogoDark: z.string().default(""),
    favicon: z.string().default("/favicon/favicon.ico"),
    description: z.string().default(""),
    keywords: z.string().default(""),
    mainColor: z.string().default("#0086BF"),
    fontFamily: z.string().default("Montserrat"),
    showFloatingThemePreview: boolField(false),
  }),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

/**
 * The environment variable that sets each setting: `VITE_*` in the browser during
 * development and in the build that writes `config.js`; the nginx image takes the same
 * names without the `VITE_` prefix (`render-frontend-config.sh`, checked by
 * `scripts/check-runtime-config.ts`).
 * Typed so that a setting without a variable does not compile.
 */
export const ENV_NAMES = {
  urls: {
    backend: "VITE_BACKEND_URL",
    ai: "VITE_AI_API_URL",
    marketplace: "VITE_MARKETPLACE_URL",
  },
  authentication: {
    allowEmailLogin: "VITE_AUTHENTICATION_ALLOW_EMAIL_LOGIN",
    identityProviders: "VITE_AUTHENTICATION_IDENTITY_PROVIDERS",
    sendMicrosoftIdToken: "VITE_AUTHENTICATION_SEND_MICROSOFT_IDTOKEN",
    sendOktaIdToken: "VITE_AUTHENTICATION_SEND_OKTA_IDTOKEN",
    sendUserEmailAsHeader: "VITE_AUTHENTICATION_SEND_USER_EMAIL_AS_HEADER",
  },
  authProviders: {
    googleClientId: "VITE_GOOGLE_OAUTH_CLIENT_ID",
    azureClientId: "VITE_AZURE_CLIENT_ID",
    azureTenantId: "VITE_AZURE_TENANT_ID",
    oktaClientId: "VITE_OKTA_CLIENT_ID",
    oktaDomain: "VITE_OKTA_DOMAIN",
  },
  copilot: {
    enabled: "VITE_AI_COPILOT_ENABLED",
    defaultCopilot: "VITE_AI_COPILOT_DEFAULT_COPILOT",
    documentationLinks: "VITE_AI_COPILOT_DOCUMENTATION_LINKS",
    webSearch: "VITE_AI_COPILOT_WEB_SEARCH",
    secFilings: "VITE_AI_COPILOT_SEC_FILINGS",
    jinaAi: "VITE_AI_COPILOT_JINA_AI",
    aiEnhancements: "VITE_AI_COPILOT_AI_ENHANCEMENTS",
    saveSkillFromChat: "VITE_AI_COPILOT_SAVE_SKILL_FROM_CHAT",
    showCustomKey: "VITE_AI_SHOW_CUSTOM_COPILOT_KEY",
  },
  ui: {
    showCompanionMode: "VITE_UI_SHOW_COMPANION_MCP_MODE",
    showMinimizeWidget: "VITE_UI_SHOW_MINIMIZE_WIDGET",
    showExternalDocLinks: "VITE_UI_SHOW_EXTERNAL_DOCUMENTATION_LINKS",
    showHelpDocumentation: "VITE_UI_SHOW_HELP_DOCUMENTATION",
    showChangelog: "VITE_UI_SHOW_CHANGELOG",
    showCopilotSwitcher: "VITE_UI_SHOW_COPILOT_SWITCHER",
    showRemoveFromOrg: "VITE_UI_SHOW_REMOVE_FROM_ORG",
    defaultTheme: "VITE_UI_DEFAULT_THEME",
    showMarketplace: "VITE_UI_SHOW_MARKETPLACE",
  },
  data: {
    allowHtmlJsExecution: "VITE_ALLOW_HTML_JS_EXECUTION",
  },
  links: {
    docsUrl: "VITE_DOCS_URL",
  },
  contact: {
    supportEmail: "VITE_SUPPORT_EMAIL",
  },
  whiteLabel: {
    name: "VITE_WL_NAME",
    shortName: "VITE_WL_SHORT_NAME",
    loginImage: "VITE_WL_LOGIN_IMAGE",
    loginImageDark: "VITE_WL_LOGIN_IMAGE_DARK",
    leftSidebarLogo: "VITE_WL_LEFT_SIDEBAR_LOGO",
    leftSidebarLogoDark: "VITE_WL_LEFT_SIDEBAR_LOGO_DARK",
    favicon: "VITE_WL_FAVICON",
    description: "VITE_WL_DESCRIPTION",
    keywords: "VITE_WL_KEYWORDS",
    mainColor: "VITE_WL_MAIN_COLOR",
    fontFamily: "VITE_WL_FONT_FAMILY",
    showFloatingThemePreview: "VITE_WL_SHOW_FLOATING_THEME_PREVIEW",
  },
} as const satisfies {
  [G in keyof RuntimeConfig]: { [F in keyof RuntimeConfig[G]]: string };
};

/** The configuration that the environment variables of `ENV_NAMES` describe. Coercion and defaults are the schema's. */
export function configFromEnv(env: Record<string, unknown>): RuntimeConfig {
  const groups = Object.entries(ENV_NAMES).map(([group, fields]) => [
    group,
    Object.fromEntries(
      Object.entries(fields).map(([field, name]) => [field, env[name]]),
    ),
  ]);
  return RuntimeConfigSchema.parse(Object.fromEntries(groups));
}
