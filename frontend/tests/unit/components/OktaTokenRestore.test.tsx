import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OktaTokenRestore from "~/components/OktaTokenRestore";
import { useAuthStore } from "~/lib/state/auth";
import {
  clearIdpTokens,
  getIdpTokens,
  rememberSignInProvider,
  setIdpTokens,
} from "~/lib/state/idpTokens";
import { mockConfig } from "../../mocks/runtimeConfig";
import { makeAuthUser } from "../factories";

const mockGetWithoutPrompt = vi.fn();

vi.mock("~/lib/okta-auth-config", () => ({
  getOktaAuth: () => ({ token: { getWithoutPrompt: mockGetWithoutPrompt } }),
  oktaLoginRequest: {
    scopes: ["openid", "profile", "email"],
    prompt: "select_account",
  },
}));

const mockLogout = vi.fn();
const mockUser = makeAuthUser({ email: "user@example.com" });
const flushEffects = () => act(async () => {});

describe("OktaTokenRestore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No Okta session in the browser: a user who signed in some other way
    mockGetWithoutPrompt.mockRejectedValue(new Error("login_required"));
    useAuthStore.setState({ user: mockUser, logout: mockLogout });
    clearIdpTokens();
    mockConfig.authentication.sendOktaIdToken = true;
  });

  afterEach(() => {
    mockConfig.authentication.sendOktaIdToken = false;
    sessionStorage.clear();
  });

  it("asks Okta for the ID token again without a prompt after a reload", async () => {
    mockGetWithoutPrompt.mockResolvedValue({
      tokens: { idToken: { idToken: "restored-okta-id-token" } },
    });

    render(<OktaTokenRestore>app</OktaTokenRestore>);

    await waitFor(() =>
      expect(getIdpTokens().oktaIdToken).toBe("restored-okta-id-token"),
    );
    expect(mockGetWithoutPrompt).toHaveBeenCalledWith({
      scopes: ["openid", "profile", "email"],
      loginHint: "user@example.com",
    });
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("signs out a tab that signed in with Okta when it cannot get the token back", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rememberSignInProvider("okta");

    render(<OktaTokenRestore>app</OktaTokenRestore>);

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it("keeps a tab that signed in some other way, and tries only once", async () => {
    const { rerender } = render(<OktaTokenRestore>app</OktaTokenRestore>);
    await flushEffects();
    rerender(<OktaTokenRestore>again</OktaTokenRestore>);
    await flushEffects();

    expect(mockGetWithoutPrompt).toHaveBeenCalledTimes(1);
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("asks nothing while the token is in memory, or when the deployment does not forward it", async () => {
    setIdpTokens({ oktaIdToken: "in-memory" });
    const { unmount } = render(<OktaTokenRestore>app</OktaTokenRestore>);
    await flushEffects();
    unmount();

    clearIdpTokens();
    mockConfig.authentication.sendOktaIdToken = false;
    rememberSignInProvider("okta");
    render(<OktaTokenRestore>app</OktaTokenRestore>);
    await flushEffects();

    expect(mockGetWithoutPrompt).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });
});
