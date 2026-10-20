import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MsalTokenRefresh from "~/components/MsalTokenRefresh";
import { useAuthStore } from "~/lib/state/auth";
import {
  clearIdpTokens,
  getIdpTokens,
  rememberSignInProvider,
  setIdpTokens,
} from "~/lib/state/idpTokens";
import { mockConfig } from "../../mocks/runtimeConfig";
import { makeAuthUser } from "../factories";

const mockAcquireTokenSilent = vi.fn();
const mockGetActiveAccount = vi.fn();
const mockSetActiveAccount = vi.fn();
const mockSsoSilent = vi.fn();
const mockInstance = {
  acquireTokenSilent: mockAcquireTokenSilent,
  getActiveAccount: mockGetActiveAccount,
  setActiveAccount: mockSetActiveAccount,
  ssoSilent: mockSsoSilent,
};
let mockAccounts: Array<{ username: string }> = [];
let mockInProgress = "none";

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({
    instance: mockInstance,
    accounts: mockAccounts,
    inProgress: mockInProgress,
  }),
}));

const mockLogout = vi.fn();

const mockUser = makeAuthUser({ email: "user@example.com" });

const ONE_HOUR_MS = 60 * 60 * 1000;

const tokenResult = (idToken: string, expiresAtMs: number) => ({
  idToken,
  account: { username: "user@example.com" },
  idTokenClaims: { exp: Math.floor(expiresAtMs / 1000) },
});

const flushEffects = () => act(async () => {});

describe("MsalTokenRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccounts = [];
    mockInProgress = "none";
    mockGetActiveAccount.mockReturnValue(null);
    mockAcquireTokenSilent.mockResolvedValue(
      tokenResult("fresh-id-token", Date.now() + ONE_HOUR_MS),
    );
    // No Microsoft session in the browser: a user who signed in some other way
    mockSsoSilent.mockRejectedValue(new InteractionRequiredAuthError("login_required"));
    useAuthStore.setState({ user: mockUser, logout: mockLogout });
    clearIdpTokens();
    mockConfig.authentication.sendMicrosoftIdToken = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    mockConfig.authentication.sendMicrosoftIdToken = false;
    sessionStorage.clear();
  });

  describe("after a reload, when MSAL holds no account", () => {
    it("asks Microsoft for the ID token again without a prompt", async () => {
      mockSsoSilent.mockResolvedValue(
        tokenResult("restored-id-token", Date.now() + ONE_HOUR_MS),
      );

      render(<MsalTokenRefresh>app</MsalTokenRefresh>);

      await waitFor(() =>
        expect(getIdpTokens().microsoftIdToken).toBe("restored-id-token"),
      );
      expect(mockSsoSilent).toHaveBeenCalledWith({
        scopes: ["User.Read"],
        loginHint: "user@example.com",
      });
      expect(mockSetActiveAccount).toHaveBeenCalledWith({
        username: "user@example.com",
      });
      expect(mockLogout).not.toHaveBeenCalled();
    });

    it("signs out a tab that signed in with Microsoft when it cannot get the token back", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      rememberSignInProvider("microsoft");

      render(<MsalTokenRefresh>app</MsalTokenRefresh>);

      await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    });

    it("keeps a tab that signed in some other way, and tries only once", async () => {
      const { rerender } = render(<MsalTokenRefresh>app</MsalTokenRefresh>);
      await flushEffects();
      mockInProgress = "ssoSilent";
      rerender(<MsalTokenRefresh>app</MsalTokenRefresh>);
      mockInProgress = "none";
      rerender(<MsalTokenRefresh>app</MsalTokenRefresh>);
      await flushEffects();

      expect(mockSsoSilent).toHaveBeenCalledTimes(1);
      expect(mockLogout).not.toHaveBeenCalled();
    });

    it("asks nothing when the deployment does not forward the ID token", async () => {
      mockConfig.authentication.sendMicrosoftIdToken = false;
      rememberSignInProvider("microsoft");

      render(<MsalTokenRefresh>app</MsalTokenRefresh>);
      await flushEffects();

      expect(mockSsoSilent).not.toHaveBeenCalled();
      expect(mockLogout).not.toHaveBeenCalled();
    });
  });

  it("renders its children", async () => {
    render(
      <MsalTokenRefresh>
        <div>child content</div>
      </MsalTokenRefresh>,
    );

    expect(screen.getByText("child content")).toBeInTheDocument();
    await flushEffects();
  });

  it("does not attempt a refresh when MSAL has no accounts", async () => {
    render(<MsalTokenRefresh>app</MsalTokenRefresh>);
    await flushEffects();

    expect(mockAcquireTokenSilent).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("refreshes the token for the active MSAL account even when its username differs from the backend email", async () => {
    // UPN (e.g. jdoe@corp.onmicrosoft.com) routinely differs from the Graph
    // `mail` attribute the backend stores as the user's email
    const activeAccount = { username: "jdoe@corp.onmicrosoft.com" };
    mockGetActiveAccount.mockReturnValue(activeAccount);
    mockAccounts = [activeAccount];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);

    await waitFor(() => expect(mockAcquireTokenSilent).toHaveBeenCalledTimes(1));
    expect(mockAcquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({ account: activeAccount }),
    );
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("falls back to email matching when no active account is set", async () => {
    mockAccounts = [{ username: "USER@Example.com" }];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);

    await waitFor(() => expect(mockAcquireTokenSilent).toHaveBeenCalledTimes(1));
    expect(mockAcquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({
        account: mockAccounts[0],
        scopes: ["User.Read"],
        forceRefresh: true,
      }),
    );
    await waitFor(() => expect(getIdpTokens().microsoftIdToken).toBe("fresh-id-token"));
    expect(mockLogout).not.toHaveBeenCalled();
    // The refreshed account becomes the active account so future refreshes
    // no longer depend on the email match
    expect(mockSetActiveAccount).toHaveBeenCalledWith(
      expect.objectContaining({ username: "user@example.com" }),
    );
  });

  it("schedules a follow-up refresh before the token expires", async () => {
    vi.useFakeTimers();
    const expiresInMs = 1_000_000;
    mockAcquireTokenSilent.mockResolvedValue(
      tokenResult("fresh-id-token", Date.now() + expiresInMs),
    );
    mockAccounts = [{ username: "user@example.com" }];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);
    await flushEffects();
    expect(mockAcquireTokenSilent).toHaveBeenCalledTimes(1);

    // Refresh is scheduled at 90% of the token lifetime
    await act(async () => {
      await vi.advanceTimersByTimeAsync(expiresInMs * 0.9 + 1);
    });
    expect(mockAcquireTokenSilent).toHaveBeenCalledTimes(2);
  });

  it("logs out when the user has a Microsoft token but no MSAL account matches", async () => {
    setIdpTokens({ microsoftIdToken: "stale-token" });
    mockAccounts = [{ username: "someone-else@corp.com" }];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(mockAcquireTokenSilent).not.toHaveBeenCalled();
  });

  it("logs out when the user has a Microsoft token but MSAL has no accounts at all", async () => {
    setIdpTokens({ microsoftIdToken: "stale-token" });
    mockAccounts = [];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(mockAcquireTokenSilent).not.toHaveBeenCalled();
  });

  it("waits for MSAL to finish initializing before checking the token", async () => {
    setIdpTokens({ microsoftIdToken: "stale-token" });
    mockAccounts = [{ username: "user@example.com" }];
    mockInProgress = "startup";

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);
    await flushEffects();

    expect(mockAcquireTokenSilent).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("does not log out when no MSAL account matches and no Microsoft token is stored", async () => {
    mockAccounts = [{ username: "someone-else@corp.com" }];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);
    await flushEffects();

    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockAcquireTokenSilent).not.toHaveBeenCalled();
  });

  it("logs out when the silent refresh requires user interaction", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockAcquireTokenSilent.mockRejectedValue(
      new InteractionRequiredAuthError("interaction_required"),
    );
    mockAccounts = [{ username: "user@example.com" }];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it("does not log out on transient refresh errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockAcquireTokenSilent.mockRejectedValue(new Error("network down"));
    mockAccounts = [{ username: "user@example.com" }];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);
    await flushEffects();

    expect(mockLogout).not.toHaveBeenCalled();
    expect(getIdpTokens().microsoftIdToken).toBe("");
  });

  it("keeps the refreshed ID token only when the deployment forwards it", async () => {
    mockConfig.authentication.sendMicrosoftIdToken = false;
    mockAccounts = [{ username: "user@example.com" }];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);

    await waitFor(() => expect(mockAcquireTokenSilent).toHaveBeenCalledTimes(1));
    await flushEffects();
    expect(getIdpTokens().microsoftIdToken).toBe("");
  });

  it("keeps the ID token out of browser storage", async () => {
    localStorage.clear();
    sessionStorage.clear();
    mockAccounts = [{ username: "user@example.com" }];

    render(<MsalTokenRefresh>app</MsalTokenRefresh>);

    await waitFor(() => expect(getIdpTokens().microsoftIdToken).toBe("fresh-id-token"));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
