import { z } from "zod";

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

export function parseBool(value: unknown, fallback: boolean): boolean {
  return coerceBool(value) ?? fallback;
}

export function parseStringArray(value: unknown): string[] {
  return coerceStringArray(value) ?? [];
}

export const IDENTITY_PROVIDERS = ["google", "microsoft", "okta"] as const;

const boolField = (defaultVal: boolean, description: string) =>
  z.preprocess(coerceBool, z.boolean().default(defaultVal)).describe(description);

const strArrayField = (
  defaultVal: string[],
  description: string,
  itemValues?: readonly string[],
) => {
  const field = z
    .preprocess(coerceStringArray, z.array(z.string()).default(defaultVal))
    .describe(description);
  return itemValues ? field.meta({ itemValues }) : field;
};

const stringField = (defaultVal: string, description: string) =>
  z.string().default(defaultVal).describe(description);

export const RuntimeConfigSchema = z.object({
  urls: z.object({
    backend: stringField(
      "",
      "Address of the Workspace API, which the app calls for everything except Copilot questions.",
    ),
    ai: stringField(
      "",
      "Address of the built-in Copilot agent (Ines), which the app sends Copilot questions to.",
    ),
  }),
  authentication: z.object({
    allowEmailLogin: boolField(
      true,
      "Offer sign-in with an email address and password on the login page. Turn it off when users sign in only through an identity provider.",
    ),
    identityProviders: strArrayField(
      [],
      "The identity providers that the login page offers, as a comma-separated list. The app ignores any other item.",
      IDENTITY_PROVIDERS,
    ),
    sendMicrosoftIdToken: boolField(
      false,
      "Send the signed-in user's Microsoft ID token to data backends in the X-Microsoft-Id-Token request header.",
    ),
    sendOktaIdToken: boolField(
      false,
      "Send the signed-in user's Okta ID token to data backends in the X-Okta-Id-Token request header.",
    ),
    sendUserEmailAsHeader: boolField(
      false,
      "Send the signed-in user's email address to data backends in the X-Workspace-User request header.",
    ),
  }),
  authProviders: z.object({
    googleClientId: stringField(
      "",
      "OAuth client id of the Google sign-in. Set it when identityProviders includes google.",
    ),
    azureClientId: stringField(
      "",
      "Application (client) id of the Microsoft Entra ID app registration. Set it when identityProviders includes microsoft.",
    ),
    azureTenantId: stringField(
      "",
      "Directory (tenant) id of the Microsoft Entra ID app registration, which forms the address that users sign in at. Set it when identityProviders includes microsoft.",
    ),
    oktaClientId: stringField(
      "",
      "Client id of the Okta application. Set it when identityProviders includes okta.",
    ),
    oktaDomain: stringField(
      "",
      "Issuer URL of the Okta authorization server, for example https://example.okta.com/oauth2/default. Okta sign-in is available only when it is set.",
    ),
  }),
  copilot: z.object({
    enabled: boolField(
      false,
      "Turn the Copilot on. It is available only when this is on and at least one agent exists, either the built-in one (defaultCopilot) or a custom one that a user added.",
    ),
    defaultCopilot: boolField(
      true,
      "Offer the built-in Copilot agent (Ines) as an agent that users can choose.",
    ),
    documentationLinks: boolField(
      true,
      "Show links to the documentation on the Copilot welcome screen.",
    ),
    aiEnhancements: boolField(
      true,
      "Offer the AI-assisted features outside the chat panel, such as suggested names, documents that the Copilot can read and turning an artifact into a widget. Each user can turn them off in Settings. Needs copilot.enabled.",
    ),
    saveSkillFromChat: boolField(
      false,
      "Let users save a skill from a conversation with the Copilot. Needs copilot.enabled.",
    ),
    showCustomKey: boolField(
      true,
      "Show the user's remaining Copilot questions and the option to use their own OpenAI key in the agent picker.",
    ),
  }),
  ui: z.object({
    showCompanionMode: boolField(
      false,
      "Show the MCP Companion entry in the menu, which opens the dialog for connecting an MCP client.",
    ),
    showMinimizeWidget: boolField(true, "Show the minimize button on widgets."),
    showExternalDocLinks: boolField(
      true,
      "Show the links to the documentation on the home page. They need links.docsUrl.",
    ),
    showHelpDocumentation: boolField(
      true,
      "Show the help documentation entry in the menu. It needs links.docsUrl.",
    ),
    showChangelog: boolField(true, "Show the changelog dialog in the sidebar."),
    showCopilotSwitcher: boolField(
      true,
      "Let users switch between agents in the Copilot panel. Off, the panel shows the current agent without the picker.",
    ),
    showRemoveFromOrg: boolField(
      true,
      "Show the button that removes a user from the organization in the user details of the admin area.",
    ),
    defaultTheme: z
      .enum(["light", "dark"])
      .default("dark")
      .describe("The theme that a user sees until they choose one."),
  }),
  data: z.object({
    allowHtmlJsExecution: boolField(
      false,
      "Let scripts in HTML widgets and in HTML artifacts of the Copilot run. Off, those pages run no script.",
    ),
  }),
  links: z.object({
    docsUrl: stringField(
      "",
      "Address of the documentation that the app links to. Without it the app shows no documentation links.",
    ),
  }),
  contact: z.object({
    supportEmail: stringField(
      "",
      "Email address of the support contact. The login page and the Copilot error screen show it to users who need help.",
    ),
  }),
  whiteLabel: z.object({
    name: stringField(
      "FINOS Workspace",
      "The product name, used as the title of the page and as the alternative text of the logos. The build also writes it into the manifest of the web app, and config.js cannot change that.",
    ),
    loginImage: stringField(
      "/assets/images/logo-horizontal-color.svg",
      "Address of the logo on the login and password reset pages.",
    ),
    leftSidebarLogo: stringField(
      "",
      "Address of the logo at the top of the sidebar. Empty, the sidebar shows the horizontal logo of the product.",
    ),
    leftSidebarLogoDark: stringField(
      "",
      "Address of the sidebar logo in the dark theme. Empty, the app uses leftSidebarLogo.",
    ),
    favicon: stringField("/logo.svg", "Address of the icon in the browser tab."),
    description: stringField(
      "An open, self-hosted analytics workspace for financial institutions to connect data, tools, and AI agents.",
      "The description of the product that search engines and link previews show. The build also writes it into the manifest of the web app, and config.js cannot change that.",
    ),
    keywords: stringField(
      "FINOS Workspace, open source financial analytics, self-hosted analytics, financial data workspace, AI agents",
      "The keywords of the page, comma-separated.",
    ),
    stylesheet: stringField(
      "",
      "Address of a stylesheet that the app loads at startup, for example the stylesheet of a theme.",
    ),
  }),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const ENV_NAMES = {
  urls: {
    backend: "VITE_BACKEND_URL",
    ai: "VITE_AI_API_URL",
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
    loginImage: "VITE_WL_LOGIN_IMAGE",
    leftSidebarLogo: "VITE_WL_LEFT_SIDEBAR_LOGO",
    leftSidebarLogoDark: "VITE_WL_LEFT_SIDEBAR_LOGO_DARK",
    favicon: "VITE_WL_FAVICON",
    description: "VITE_WL_DESCRIPTION",
    keywords: "VITE_WL_KEYWORDS",
    stylesheet: "VITE_WL_STYLESHEET",
  },
} as const satisfies {
  [G in keyof RuntimeConfig]: { [F in keyof RuntimeConfig[G]]: string };
};

export const BUILD_VARIABLES = {
  VITE_RELEASE_VERSION: {
    description:
      "The version that the sidebar and the changelog show. It is fixed when the app is built, and config.js cannot change it.",
    default: null,
    values: null,
  },
  VITE_ENABLE_RENDER_SCANNING: {
    description:
      "With true, the app loads react-scan, which marks the components that render again, for performance work. Only the value true turns it on, and it is fixed when the app is built.",
    default: "false",
    values: ["true", "false"],
  },
  VITE_WL_SHORT_NAME: {
    description:
      "The short name in the manifest of the web app, which is the name under the icon of the installed app. Only the build reads it.",
    default: null,
    values: null,
  },
} as const;

export function configFromEnv(env: Record<string, unknown>): RuntimeConfig {
  const groups = Object.entries(ENV_NAMES).map(([group, fields]) => [
    group,
    Object.fromEntries(
      Object.entries(fields).map(([field, name]) => [field, env[name]]),
    ),
  ]);
  return RuntimeConfigSchema.parse(Object.fromEntries(groups));
}
