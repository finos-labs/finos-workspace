import { afterEach, describe, expect, it } from "vitest";
import { removeRetiredBrowserSecrets } from "~/lib/retiredBrowserSecrets";
import { mockConfig } from "../../mocks/runtimeConfig";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

describe("removeRetiredBrowserSecrets", () => {
  afterEach(() => {
    localStorage.clear();
    mockConfig.authProviders.azureClientId = "";
  });

  it("removes the auth store, MCP OAuth tokens and MSAL cache earlier versions left", () => {
    mockConfig.authProviders.azureClientId = CLIENT_ID;
    const idTokenKey = `uid.utid-login.windows.net-idtoken-${CLIENT_ID}-tenant---`;
    const refreshKey = "uid.utid-login.windows.net-refreshtoken-other-client----";
    localStorage.setItem(
      "auth-storage",
      JSON.stringify({
        state: { user: { token: "OLD-SESSION" }, openaiApiKey: "sk-old" },
      }),
    );
    localStorage.setItem("mcp:auth_abc_tokens", "OLD-MCP-REFRESH-TOKEN");
    localStorage.setItem("mcp:auth_abc_code_verifier", "OLD-PKCE");
    localStorage.setItem(
      "msal.account.keys",
      JSON.stringify(["uid.utid-login.windows.net-tenant"]),
    );
    localStorage.setItem("uid.utid-login.windows.net-tenant", "OLD-ACCOUNT");
    localStorage.setItem(
      `msal.token.keys.${CLIENT_ID}`,
      JSON.stringify({
        idToken: [idTokenKey],
        accessToken: [],
        refreshToken: [refreshKey],
      }),
    );
    localStorage.setItem(idTokenKey, "OLD-ID-TOKEN");
    localStorage.setItem(refreshKey, "OLD-MS-REFRESH-TOKEN");
    localStorage.setItem("msal.version", "4.18.0");

    removeRetiredBrowserSecrets();

    expect(localStorage.length).toBe(0);
  });

  it("leaves what the web app still keeps", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme-storage", JSON.stringify({ state: { theme: "dark" } }));

    removeRetiredBrowserSecrets();

    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("theme-storage")).not.toBeNull();
  });

  it("expires the cookie that held the MSAL cache's key", () => {
    // biome-ignore lint/suspicious/noDocumentCookie: the cookie as MSAL wrote it
    document.cookie = "msal.cache.encryption=OLD-KEY; Path=/";

    removeRetiredBrowserSecrets();

    expect(document.cookie).not.toContain("msal.cache.encryption");
  });
});
