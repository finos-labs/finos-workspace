import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import * as authApi from "~/api/auth.api";
import LoginPage from "~/routes/login";
import type { LoginResponse, SessionResponse } from "~/types/auth.type";
import { partial } from "../mocks";

const mockNavigate = vi.fn();
const mockRestoreSession = vi.fn<() => Promise<boolean>>();
const mockStartSession = vi.fn();
const mockProviders = vi.fn(() => ["google"]);

// Mock many things
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("~/components/LayoutUnauth/GoogleLogin", () => ({
  GoogleLogin: () => <div>Google Login</div>,
}));
vi.mock("~/components/LayoutUnauth/MicrosoftLogin", () => ({
  default: ({ handleLogin }: { handleLogin: (instance: unknown) => Promise<void> }) => (
    <button type="button" onClick={() => handleLogin(mockMsalInstance)}>
      Sign in with Microsoft
    </button>
  ),
}));
vi.mock("~/components/LayoutUnauth/OktaLogin", () => ({
  default: ({ handleLogin }: { handleLogin: (oktaAuth: unknown) => Promise<void> }) => (
    <button type="button" onClick={() => handleLogin(mockOktaAuth)}>
      Sign in with Okta
    </button>
  ),
}));

const mockMsalInstance = { loginPopup: vi.fn(), setActiveAccount: vi.fn() };
const mockOktaAuth = { token: { getWithPopup: vi.fn() } };

// The code entry (input-otp) needs layout APIs jsdom lacks; this one submits a code
// and closes on success, as the real form does
vi.mock("~/components/Auth/TOTPEnterForm", () => ({
  default: ({
    handleSubmit,
    handleClose,
  }: {
    handleSubmit: (code: number) => Promise<number>;
    handleClose: () => void;
  }) => (
    <button
      type="button"
      onClick={async () => {
        if ((await handleSubmit(123456)) === 200) handleClose();
      }}
    >
      Submit code
    </button>
  ),
}));

// The code entry (input-otp) needs layout APIs jsdom lacks
vi.mock("~/components/Auth/TOTPEnterDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div>Enter your authenticator code</div> : null,
}));

vi.mock("~/api/auth.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/api/auth.api")>();
  return {
    login: vi.fn(),
    isValidMainTicker: vi.fn(() => true),
    activateTotp: vi.fn(),
    generateQRCode: vi.fn(),
    getSession: vi.fn(),
    microsoftLogin: vi.fn(),
    oktaLogin: vi.fn(),
    googleLogin: vi.fn(),
    // The nonce comes from the (mocked) API client
    SIGN_IN_EXPIRED: actual.SIGN_IN_EXPIRED,
    withSignInNonce: actual.withSignInNonce,
  };
});

vi.mock("~/api/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

/** The API's answers to POST /app/sign-in/nonce, in order. */
function nonces(...values: string[]) {
  for (const nonce of values) {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { nonce } });
  }
}

vi.mock("~/lib/identityProviders", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEnabledIdentityProviders: () => mockProviders(),
  };
});

// Mock all internal stores to avoid state issues
vi.mock("~/lib/state/auth", () => ({
  useShallowAuthStore: vi.fn((cb) =>
    cb({
      user: null,
      logout: vi.fn(),
      login: vi.fn(),
      restoreSession: mockRestoreSession,
      lastVisitedPage: "/app/last",
    }),
  ),
  useAuthStore: {
    getState: () => ({ login: vi.fn(), startSession: mockStartSession }),
  },
}));

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: vi.fn(() => ({ updateRemoteItems: vi.fn() })),
}));
vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: vi.fn(() => ({ updateThemeState: vi.fn() })),
}));

vi.mock("~/lib/state/backendConnector", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useShallowBackendConnectorStore: vi.fn(() => ({ updateBackendConnector: vi.fn() })),
  };
});
vi.mock("~/lib/state/mcpTools", () => ({
  useShallowMcpToolsStore: vi.fn(() => ({ updateServers: vi.fn() })),
}));
vi.mock("~/lib/state/entityTheme", () => ({
  useShallowEntityThemeStore: vi.fn(() => ({ updateThemeSettings: vi.fn() })),
}));

function renderLoginPage() {
  render(
    <BrowserRouter>
      <LoginPage />
    </BrowserRouter>,
  );
}

async function signIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "test@test.com");
  await user.type(screen.getByLabelText("Password"), "Password123!");
  await user.click(screen.getByRole("button", { name: "Login" }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRestoreSession.mockResolvedValue(false);
    mockProviders.mockReturnValue(["google"]);
    vi.mocked(apiClient.post).mockReset();
  });

  it("sends a visitor whose session cookie still holds a session straight on", async () => {
    mockRestoreSession.mockResolvedValue(true);

    renderLoginPage();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/app/last"));
  });

  it("stays on the login page when there is no session", async () => {
    renderLoginPage();

    await waitFor(() => expect(mockRestoreSession).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
  });

  it("asks to set up an authenticator when the organization requires one", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      status: 202,
      detail: "",
      two_factor_required: true,
    });
    renderLoginPage();

    await signIn();

    expect(
      await screen.findByText(/Your company requires two factor authentication/),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("is signed in by turning on the required authenticator, never sending its code again", async () => {
    const session = partial<SessionResponse>({ uuid: "u-1", email: "test@test.com" });
    vi.mocked(authApi.login).mockResolvedValue({
      status: 202,
      detail: "",
      two_factor_required: true,
    });
    vi.mocked(authApi.generateQRCode).mockResolvedValue({
      uri: "otpauth://totp/Workspace:test@test.com?secret=ABC",
      secret: "ABC",
    });
    vi.mocked(authApi.activateTotp).mockResolvedValue(200);
    vi.mocked(authApi.getSession).mockResolvedValue(session);
    renderLoginPage();

    await signIn();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Generate Token" }));
    await user.click(await screen.findByRole("button", { name: "Submit code" }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/app/last"));
    // The activation started the session; the page reads it, as after a reload
    expect(authApi.activateTotp).toHaveBeenCalledWith(123456, { remember: false });
    expect(mockStartSession).toHaveBeenCalledWith(session);
    // The single-use code never goes to /app/login, which would refuse it as replayed
    expect(authApi.login).toHaveBeenCalledTimes(1);
    expect(authApi.login).toHaveBeenCalledWith("test@test.com", "Password123!", false);
  });

  it("stays on the login page when the authenticator code is refused", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      status: 202,
      detail: "",
      two_factor_required: true,
    });
    vi.mocked(authApi.generateQRCode).mockResolvedValue({
      uri: "otpauth://x",
      secret: "ABC",
    });
    vi.mocked(authApi.activateTotp).mockResolvedValue(401);
    renderLoginPage();

    await signIn();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Generate Token" }));
    await user.click(await screen.findByRole("button", { name: "Submit code" }));

    await waitFor(() => expect(authApi.activateTotp).toHaveBeenCalledTimes(1));
    expect(authApi.getSession).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  describe("signing in with Microsoft", () => {
    const popupResult = (idToken: string) => ({
      accessToken: "graph-token",
      idToken,
      account: { homeAccountId: "acc" },
    });

    beforeEach(() => {
      mockProviders.mockReturnValue(["microsoft"]);
    });

    it("asks the API for a nonce first and has Microsoft put it in the ID token", async () => {
      nonces("nonce-1");
      mockMsalInstance.loginPopup.mockResolvedValue(popupResult("id-1"));
      vi.mocked(authApi.microsoftLogin).mockResolvedValue(
        partial<LoginResponse>({
          status: 200,
          uuid: "u-1",
          user: partial({ display_settings: {} }),
          dash_sync: { owned: {}, shared: {}, entity_shared: {} },
        }),
      );
      renderLoginPage();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Sign in with Microsoft" }));

      await waitFor(() =>
        expect(authApi.microsoftLogin).toHaveBeenCalledWith("graph-token", "id-1"),
      );
      expect(apiClient.post).toHaveBeenCalledWith("/app/sign-in/nonce");
      expect(mockMsalInstance.loginPopup).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: "nonce-1" }),
      );
    });

    it("starts again with a new nonce when the API says the sign-in expired", async () => {
      nonces("nonce-old", "nonce-new");
      mockMsalInstance.loginPopup
        .mockResolvedValueOnce(popupResult("id-old"))
        .mockResolvedValueOnce(popupResult("id-new"));
      vi.mocked(authApi.microsoftLogin)
        .mockResolvedValueOnce({ status: 400, detail: authApi.SIGN_IN_EXPIRED })
        .mockResolvedValueOnce({ status: 202, detail: "", two_factor_required: true });
      renderLoginPage();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Sign in with Microsoft" }));

      expect(
        await screen.findByText(/Your company requires two factor authentication/),
      ).toBeInTheDocument();
      expect(mockMsalInstance.loginPopup).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ nonce: "nonce-new" }),
      );
      expect(authApi.microsoftLogin).toHaveBeenLastCalledWith("graph-token", "id-new");
      expect(apiClient.post).toHaveBeenCalledTimes(2);
    });

    it("tries once more only: a second expiry is shown", async () => {
      nonces("nonce-1", "nonce-2");
      mockMsalInstance.loginPopup.mockResolvedValue(popupResult("id"));
      vi.mocked(authApi.microsoftLogin).mockResolvedValue({
        status: 400,
        detail: authApi.SIGN_IN_EXPIRED,
      });
      renderLoginPage();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Sign in with Microsoft" }));

      expect(await screen.findByText("Invalid login credentials.")).toBeInTheDocument();
      expect(authApi.microsoftLogin).toHaveBeenCalledTimes(2);
    });

    it("shows why the API refused an account whose email Microsoft has not verified", async () => {
      const detail =
        "Microsoft has not verified the email address of this account, so it cannot sign in";
      nonces("nonce-1", "nonce-2");
      mockMsalInstance.loginPopup.mockResolvedValue(popupResult("id"));
      vi.mocked(authApi.microsoftLogin).mockResolvedValue({ status: 403, detail });
      renderLoginPage();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Sign in with Microsoft" }));

      expect(await screen.findByText(detail)).toBeInTheDocument();
      expect(screen.queryByText(/Please confirm your account/)).not.toBeInTheDocument();
    });
  });

  it("asks Okta for an ID token with the API's nonce, and starts again when it expired", async () => {
    mockProviders.mockReturnValue(["okta"]);
    nonces("nonce-old", "nonce-new");
    mockOktaAuth.token.getWithPopup.mockImplementation(async ({ nonce }) => ({
      tokens: {
        accessToken: { accessToken: "okta-access" },
        idToken: { idToken: `id-${nonce}` },
      },
    }));
    vi.mocked(authApi.oktaLogin)
      .mockResolvedValueOnce({ status: 400, detail: authApi.SIGN_IN_EXPIRED })
      .mockResolvedValueOnce({ status: 202, detail: "" });
    renderLoginPage();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Sign in with Okta" }));

    expect(
      await screen.findByText("Enter your authenticator code"),
    ).toBeInTheDocument();
    expect(authApi.oktaLogin).toHaveBeenNthCalledWith(1, "okta-access", "id-nonce-old");
    expect(authApi.oktaLogin).toHaveBeenNthCalledWith(2, "okta-access", "id-nonce-new");
  });

  it("asks for the authenticator code when one is set up", async () => {
    vi.mocked(authApi.login).mockResolvedValue({ status: 202, detail: "" });
    renderLoginPage();

    await signIn();

    expect(
      await screen.findByText("Enter your authenticator code"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Your company requires two factor authentication/),
    ).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders login form correctly", () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>,
    );

    expect(screen.getByText("Sign in to your account")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
  });

  it("calls apiLogin on submit", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue(
      partial<LoginResponse>({
        status: 200,
        email: "test@test.com",
        user: { display_settings: {} },
        dash_sync: { owned: {}, shared: {}, entity_shared: {} },
      }),
    );

    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "test@test.com");
    await user.type(screen.getByLabelText("Password"), "Password123!");

    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith(
        "test@test.com",
        "Password123!",
        false,
      );
    });
  });

  it("shows error message on failed login", async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue(
      partial({
        status: 404,
        detail: "Not found",
      }),
    );

    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>,
    );

    await user.type(screen.getByLabelText("Email"), "wrong@test.com");
    await user.type(screen.getByLabelText("Password"), "WrongPassword123!");

    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(
      () => {
        expect(
          screen.getByText(/The provided credentials do not match/),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});
