import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "~/api/auth.api";
import LoginPage from "~/routes/login";
import type { LoginResponse, SessionResponse } from "~/types/auth.type";
import { partial } from "../mocks";

const mockNavigate = vi.fn();
const mockRestoreSession = vi.fn<() => Promise<boolean>>();
const mockStartSession = vi.fn();
const mockProviders = vi.fn(() => ["google"]);
let mockSearchParams = new URLSearchParams();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [mockSearchParams, vi.fn()],
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("~/components/LayoutUnauth/GoogleLogin", () => ({
  GoogleLogin: () => <div>Google Login</div>,
}));
vi.mock("~/components/LayoutUnauth/MicrosoftLogin", () => ({
  default: ({ handleLogin }: { handleLogin: () => Promise<void> }) => (
    <button type="button" onClick={() => handleLogin()}>
      Sign in with Microsoft
    </button>
  ),
}));
vi.mock("~/components/LayoutUnauth/OktaLogin", () => ({
  default: ({ handleLogin }: { handleLogin: () => Promise<void> }) => (
    <button type="button" onClick={() => handleLogin()}>
      Sign in with Okta
    </button>
  ),
}));

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

vi.mock("~/components/Auth/TOTPEnterDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div>Enter your authenticator code</div> : null,
}));

vi.mock("~/api/auth.api", () => ({
  login: vi.fn(),
  isValidMainTicker: vi.fn(() => true),
  activateTotp: vi.fn(),
  generateQRCode: vi.fn(),
  getSession: vi.fn(),
  startSignIn: vi.fn(),
  googleLogin: vi.fn(),
}));

vi.mock("~/api/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock("~/lib/identityProviders", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEnabledIdentityProviders: () => mockProviders(),
  };
});

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

  it("sends a user who forgot their password to their admin", () => {
    renderLoginPage();

    expect(
      screen.getByText("Forgot your password? Ask your admin to reset your password."),
    ).toBeInTheDocument();
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
    expect(authApi.activateTotp).toHaveBeenCalledWith(123456, { remember: false });
    expect(mockStartSession).toHaveBeenCalledWith(session);
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

  describe("signing in with Microsoft or Okta", () => {
    const originalLocation = window.location;
    const assign = vi.fn();

    beforeEach(() => {
      assign.mockReset();
      Object.defineProperty(window, "location", {
        value: { ...originalLocation, assign },
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        configurable: true,
        writable: true,
      });
    });

    it.each([
      ["microsoft", "Sign in with Microsoft"],
      ["okta", "Sign in with Okta"],
    ])("sends the browser to the address the API gives for %s", async (provider, name) => {
      mockProviders.mockReturnValue([provider]);
      vi.mocked(authApi.startSignIn).mockResolvedValue(
        "https://idp.example.com/authorize?state=s",
      );
      renderLoginPage();

      await userEvent.setup().click(screen.getByRole("button", { name }));

      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith(
          "https://idp.example.com/authorize?state=s",
        ),
      );
      expect(authApi.startSignIn).toHaveBeenCalledWith(provider);
    });

    it("shows why the API would not start the sign-in and goes nowhere", async () => {
      mockProviders.mockReturnValue(["microsoft"]);
      vi.mocked(authApi.startSignIn).mockRejectedValue({
        response: {
          status: 400,
          data: { detail: "Microsoft sign-in is not configured" },
        },
      });
      renderLoginPage();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Sign in with Microsoft" }));

      expect(
        await screen.findByText("Microsoft sign-in is not configured"),
      ).toBeInTheDocument();
      expect(assign).not.toHaveBeenCalled();
    });
  });

  describe("coming back from a provider", () => {
    afterEach(() => {
      mockSearchParams = new URLSearchParams();
    });

    it("shows the reason the API gives in the address", async () => {
      mockSearchParams = new URLSearchParams({ error: "Invalid Microsoft token" });
      renderLoginPage();

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Error", {
          description: "Invalid Microsoft token",
        }),
      );
    });

    it("opens the authenticator setup when the account must set one up", async () => {
      mockSearchParams = new URLSearchParams({ step: "totp-enroll" });
      renderLoginPage();

      expect(
        await screen.findByText(/Your company requires two factor authentication/),
      ).toBeInTheDocument();
    });
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
