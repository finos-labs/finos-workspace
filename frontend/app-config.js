// The config.js nginx serves (nginx.conf). It sets window.__APP_CONFIG__ before the app bundle
// loads, from the container's environment variables. The image has no shell to write it when the
// container starts, so nginx renders it with njs on each request. /healthz renders it too, so an
// invalid value fails the health check, and config.js answers 500.
//
// Each row maps one RuntimeConfigSchema field (src/lib/runtimeConfigSchema.ts) to an environment
// variable and a type. A field whose variable is unset is left out, so the schema default applies.
// nginx passes its workers only the variables its env directives name, so nginx.conf has one for
// each row. The image build runs scripts/check-runtime-config.ts, which fails when this table,
// nginx.conf and the schema disagree.
//
// Plain JavaScript that njs runs: no destructuring, spread or for...of.
const FIELDS = [
  ["urls", "backend", "BACKEND_URL", "string"],
  ["urls", "ai", "AI_API_URL", "string"],
  ["authentication", "allowEmailLogin", "AUTHENTICATION_ALLOW_EMAIL_LOGIN", "bool"],
  ["authentication", "identityProviders", "AUTHENTICATION_IDENTITY_PROVIDERS", "list"],
  ["authentication", "sendMicrosoftIdToken", "AUTHENTICATION_SEND_MICROSOFT_IDTOKEN", "bool"],
  ["authentication", "sendOktaIdToken", "AUTHENTICATION_SEND_OKTA_IDTOKEN", "bool"],
  ["authentication", "sendUserEmailAsHeader", "AUTHENTICATION_SEND_USER_EMAIL_AS_HEADER", "bool"],
  ["authProviders", "googleClientId", "GOOGLE_OAUTH_CLIENT_ID", "string"],
  ["authProviders", "azureClientId", "AZURE_CLIENT_ID", "string"],
  ["authProviders", "azureTenantId", "AZURE_TENANT_ID", "string"],
  ["authProviders", "oktaClientId", "OKTA_CLIENT_ID", "string"],
  ["authProviders", "oktaDomain", "OKTA_DOMAIN", "string"],
  ["copilot", "enabled", "AI_COPILOT_ENABLED", "bool"],
  ["copilot", "defaultCopilot", "AI_COPILOT_DEFAULT_COPILOT", "bool"],
  ["copilot", "documentationLinks", "AI_COPILOT_DOCUMENTATION_LINKS", "bool"],
  ["copilot", "webSearch", "AI_COPILOT_WEB_SEARCH", "bool"],
  ["copilot", "secFilings", "AI_COPILOT_SEC_FILINGS", "bool"],
  ["copilot", "jinaAi", "AI_COPILOT_JINA_AI", "bool"],
  ["copilot", "aiEnhancements", "AI_COPILOT_AI_ENHANCEMENTS", "bool"],
  ["copilot", "saveSkillFromChat", "AI_COPILOT_SAVE_SKILL_FROM_CHAT", "bool"],
  ["copilot", "showCustomKey", "AI_SHOW_CUSTOM_COPILOT_KEY", "bool"],
  ["ui", "showCompanionMode", "UI_SHOW_COMPANION_MCP_MODE", "bool"],
  ["ui", "showMinimizeWidget", "UI_SHOW_MINIMIZE_WIDGET", "bool"],
  ["ui", "showExternalDocLinks", "UI_SHOW_EXTERNAL_DOCUMENTATION_LINKS", "bool"],
  ["ui", "showHelpDocumentation", "UI_SHOW_HELP_DOCUMENTATION", "bool"],
  ["ui", "showChangelog", "UI_SHOW_CHANGELOG", "bool"],
  ["ui", "showCopilotSwitcher", "UI_SHOW_COPILOT_SWITCHER", "bool"],
  ["ui", "showRemoveFromOrg", "UI_SHOW_REMOVE_FROM_ORG", "bool"],
  ["ui", "defaultTheme", "UI_DEFAULT_THEME", "theme"],
  ["data", "allowHtmlJsExecution", "ALLOW_HTML_JS_EXECUTION", "bool"],
  ["links", "docsUrl", "DOCS_URL", "string"],
  ["contact", "supportEmail", "SUPPORT_EMAIL", "string"],
  ["whiteLabel", "name", "WL_NAME", "string"],
  ["whiteLabel", "shortName", "WL_SHORT_NAME", "string"],
  ["whiteLabel", "loginImage", "WL_LOGIN_IMAGE", "string"],
  ["whiteLabel", "loginImageDark", "WL_LOGIN_IMAGE_DARK", "string"],
  ["whiteLabel", "leftSidebarLogo", "WL_LEFT_SIDEBAR_LOGO", "string"],
  ["whiteLabel", "leftSidebarLogoDark", "WL_LEFT_SIDEBAR_LOGO_DARK", "string"],
  ["whiteLabel", "favicon", "WL_FAVICON", "string"],
  ["whiteLabel", "description", "WL_DESCRIPTION", "string"],
  ["whiteLabel", "keywords", "WL_KEYWORDS", "string"],
  ["whiteLabel", "mainColor", "WL_MAIN_COLOR", "string"],
  ["whiteLabel", "fontFamily", "WL_FONT_FAMILY", "string"],
  ["whiteLabel", "showFloatingThemePreview", "WL_SHOW_FLOATING_THEME_PREVIEW", "bool"],
];

function valueOf(variable, type, raw) {
  if (type === "string") {
    return raw;
  }
  if (type === "list") {
    // Comma-separated values, trimmed and lowercased the same way the schema coerces a
    // comma-separated string.
    return raw
      .split(",")
      .map(function (item) {
        return item.toLowerCase().trim();
      })
      .filter(function (item) {
        return item !== "";
      });
  }
  if (type === "bool") {
    if (raw === "true" || raw === "false") {
      return raw === "true";
    }
    throw new Error(variable + " must be true or false");
  }
  if (type === "theme") {
    if (raw === "light" || raw === "dark") {
      return raw;
    }
    throw new Error(variable + " must be light or dark");
  }
  throw new Error("unknown type " + type + " for " + variable);
}

function render(env) {
  const config = {};
  for (let i = 0; i < FIELDS.length; i++) {
    const group = FIELDS[i][0];
    const field = FIELDS[i][1];
    const variable = FIELDS[i][2];
    if (!config[group]) {
      config[group] = {};
    }
    if (env[variable] !== undefined) {
      config[group][field] = valueOf(variable, FIELDS[i][3], env[variable]);
    }
  }
  return "window.__APP_CONFIG__ = " + JSON.stringify(config, null, 2) + ";\n";
}

function configJs(r) {
  let body;
  try {
    body = render(process.env);
  } catch (error) {
    r.error(error.message);
    r.return(500, "");
    return;
  }
  r.return(200, body);
}

function healthz(r) {
  try {
    render(process.env);
  } catch (error) {
    r.error(error.message);
    r.return(500, JSON.stringify({ status: "error", error: error.message }));
    return;
  }
  r.return(200, '{"status": "ok"}');
}

export default { FIELDS: FIELDS, render: render, configJs: configJs, healthz: healthz };
