import { describe, expect, it } from "vitest";
import {
  configFromEnv,
  ENV_NAMES,
  RuntimeConfigSchema,
} from "~/lib/runtimeConfigSchema";

describe("configFromEnv", () => {
  it("is the schema's defaults when nothing is set", () => {
    const empty = RuntimeConfigSchema.parse({
      urls: {},
      authentication: {},
      authProviders: {},
      copilot: {},
      ui: {},
      data: {},
      links: {},
      contact: {},
      whiteLabel: {},
    });

    expect(configFromEnv({})).toEqual(empty);
  });

  it("leaves every deployment-specific value empty by default", () => {
    const cfg = configFromEnv({});

    expect(cfg.urls).toEqual({ backend: "", ai: "" });
    expect(cfg.authProviders).toEqual({
      googleClientId: "",
    });
    expect(cfg.links.docsUrl).toBe("");
    expect(cfg.contact.supportEmail).toBe("");
  });

  it("keeps the product description when the white-label variables are unset", () => {
    const cfg = configFromEnv({});

    expect(cfg.whiteLabel.description).toBe(
      "An open, self-hosted analytics workspace for financial institutions to connect data, tools, and AI agents.",
    );
    expect(cfg.whiteLabel.keywords).toBe(
      "FINOS Workspace, open source financial analytics, self-hosted analytics, financial data workspace, AI agents",
    );
  });

  it("maps the VITE_* variables onto their groups", () => {
    const cfg = configFromEnv({
      VITE_BACKEND_URL: "https://backend.test",
      VITE_AI_API_URL: "https://ai.test",
      VITE_GOOGLE_OAUTH_CLIENT_ID: "google-id",
      VITE_DOCS_URL: "https://docs.test",
      VITE_SUPPORT_EMAIL: "help@docs.test",
      VITE_WL_NAME: "Acme",
    });

    expect(cfg.urls).toEqual({
      backend: "https://backend.test",
      ai: "https://ai.test",
    });
    expect(cfg.authProviders.googleClientId).toBe("google-id");
    expect(cfg.links.docsUrl).toBe("https://docs.test");
    expect(cfg.contact.supportEmail).toBe("help@docs.test");
    expect(cfg.whiteLabel.name).toBe("Acme");
  });

  it("coerces booleans and lists from their text form", () => {
    const cfg = configFromEnv({
      VITE_AI_COPILOT_ENABLED: "true",
      VITE_UI_SHOW_CHANGELOG: "false",
      VITE_AUTHENTICATION_IDENTITY_PROVIDERS: "Google, microsoft",
    });

    expect(cfg.copilot.enabled).toBe(true);
    expect(cfg.ui.showChangelog).toBe(false);
    expect(cfg.authentication.identityProviders).toEqual(["google", "microsoft"]);
  });

  it("falls back to the default for a value that is not a boolean", () => {
    expect(configFromEnv({ VITE_UI_SHOW_CHANGELOG: "maybe" }).ui.showChangelog).toBe(
      true,
    );
  });

  it("rejects a theme that is not light or dark", () => {
    expect(() => configFromEnv({ VITE_UI_DEFAULT_THEME: "neon" })).toThrow();
  });
});

describe("ENV_NAMES", () => {
  const names = Object.values(ENV_NAMES).flatMap((fields) => Object.values(fields));

  it("gives every setting its own VITE_ variable", () => {
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith("VITE_"))).toBe(true);
  });

  it("names exactly the settings of the schema", () => {
    const groups = Object.keys(RuntimeConfigSchema.shape);
    expect(Object.keys(ENV_NAMES).sort()).toEqual(groups.sort());
    for (const [group, fields] of Object.entries(ENV_NAMES)) {
      const shape = RuntimeConfigSchema.shape[group as keyof typeof ENV_NAMES].shape;
      expect(Object.keys(fields).sort()).toEqual(Object.keys(shape).sort());
    }
  });

  it("reads each setting from its variable", () => {
    const env = Object.fromEntries(
      Object.entries(ENV_NAMES.whiteLabel)
        .filter(([field]) => field !== "showFloatingThemePreview")
        .filter(([field]) => field !== "mainColor")
        .map(([field, name]) => [name, `value of ${field}`]),
    );

    const cfg = configFromEnv(env);

    expect(cfg.whiteLabel.name).toBe("value of name");
    expect(cfg.whiteLabel.favicon).toBe("value of favicon");
    expect(cfg.whiteLabel.keywords).toBe("value of keywords");
  });
});
