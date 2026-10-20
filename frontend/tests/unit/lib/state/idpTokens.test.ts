import { afterEach, describe, expect, it } from "vitest";
import { clearIdpTokens, getIdpTokens, setIdpTokens } from "~/lib/state/idpTokens";
import { addExtraHeaders } from "~/lib/utils/widgetParams";
import { mockConfig } from "../../../mocks/runtimeConfig";

describe("identity values in page memory", () => {
  afterEach(() => {
    clearIdpTokens();
    mockConfig.authentication.sendMicrosoftIdToken = false;
    mockConfig.authentication.sendOktaIdToken = false;
    mockConfig.authentication.sendUserEmailAsHeader = false;
  });

  it("keeps what it is given and forgets it on clear", () => {
    setIdpTokens({ microsoftIdToken: "ms-token" });
    setIdpTokens({ email: "user@example.com" });

    expect(getIdpTokens()).toEqual({
      microsoftIdToken: "ms-token",
      oktaIdToken: "",
      email: "user@example.com",
    });

    clearIdpTokens();
    expect(getIdpTokens()).toEqual({
      microsoftIdToken: "",
      oktaIdToken: "",
      email: "",
    });
  });

  it("never writes to browser storage", () => {
    localStorage.clear();
    sessionStorage.clear();

    setIdpTokens({ microsoftIdToken: "ms", oktaIdToken: "okta", email: "e@x.test" });

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("adds only the identity headers the deployment turns on", () => {
    setIdpTokens({ microsoftIdToken: "ms", oktaIdToken: "okta", email: "e@x.test" });
    mockConfig.authentication.sendOktaIdToken = true;

    expect(addExtraHeaders({ "X-Api-Key": "k" })).toEqual({
      "X-Api-Key": "k",
      "X-Okta-Id-Token": "okta",
    });
  });

  it("adds them to a copy, never to the saved header set it is given", () => {
    setIdpTokens({ microsoftIdToken: "ms", email: "e@x.test" });
    mockConfig.authentication.sendMicrosoftIdToken = true;
    mockConfig.authentication.sendUserEmailAsHeader = true;
    const saved = { Authorization: "Bearer agent-key" };

    const sent = addExtraHeaders(saved);

    expect(sent).toEqual({
      Authorization: "Bearer agent-key",
      "X-Microsoft-Id-Token": "ms",
      "X-Workspace-User": "e@x.test",
    });
    expect(saved).toEqual({ Authorization: "Bearer agent-key" });
  });

  it("reads nothing from localStorage", () => {
    localStorage.setItem(
      "auth-storage",
      JSON.stringify({
        state: { microsoftIdToken: "stale", user: { email: "old@x.test" } },
      }),
    );
    mockConfig.authentication.sendMicrosoftIdToken = true;
    mockConfig.authentication.sendUserEmailAsHeader = true;

    expect(addExtraHeaders()).toEqual({});
    localStorage.clear();
  });
});
