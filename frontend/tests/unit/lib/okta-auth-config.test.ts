import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockConfig } from "../../mocks/runtimeConfig";

vi.mock("@okta/okta-auth-js", () => ({
  OktaAuth: vi.fn().mockImplementation((config) => ({
    _config: config,
  })),
}));

describe("getOktaAuth", () => {
  let getOktaAuth: typeof import("~/lib/okta-auth-config").getOktaAuth;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("~/lib/runtimeConfig", () => ({
      getConfig: () => mockConfig,
      _resetConfig: vi.fn(),
    }));
    vi.doMock("@okta/okta-auth-js", () => ({
      OktaAuth: vi.fn().mockImplementation(function (
        this: Record<string, unknown>,
        config: unknown,
      ) {
        this._config = config;
      }),
    }));
    const mod = await import("~/lib/okta-auth-config");
    getOktaAuth = mod.getOktaAuth;
  });

  it("returns null when oktaDomain is not configured", () => {
    mockConfig.authProviders.oktaDomain = "";
    mockConfig.authProviders.oktaClientId = "";

    const result = getOktaAuth();
    expect(result).toBeNull();
  });

  it("returns an OktaAuth instance when oktaDomain is configured", () => {
    mockConfig.authProviders.oktaDomain = "https://dev-123.okta.com/oauth2/default";
    mockConfig.authProviders.oktaClientId = "okta-client-id";

    const result = getOktaAuth();
    expect(result).not.toBeNull();
    expect((result as { _config?: unknown } | null)?._config).toEqual(
      expect.objectContaining({
        clientId: "okta-client-id",
        issuer: "https://dev-123.okta.com/oauth2/default",
        redirectUri: window.location.origin,
        scopes: ["openid", "profile", "email"],
        pkce: true,
        tokenManager: { storage: "memory" },
      }),
    );
  });

  it("caches the result on subsequent calls", () => {
    mockConfig.authProviders.oktaDomain = "https://dev-123.okta.com/oauth2/default";
    mockConfig.authProviders.oktaClientId = "okta-client-id";

    const first = getOktaAuth();
    const second = getOktaAuth();
    expect(first).toBe(second);
  });

  it("caches null when domain is empty (does not retry)", () => {
    mockConfig.authProviders.oktaDomain = "";

    const first = getOktaAuth();
    expect(first).toBeNull();

    mockConfig.authProviders.oktaDomain = "https://dev-123.okta.com/oauth2/default";
    const second = getOktaAuth();
    expect(second).toBeNull();
  });
});
