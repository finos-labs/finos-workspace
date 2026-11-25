import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmSignup } from "~/api/auth.api";
import SignupConfirmPage from "~/routes/signupConfirm";
import { invalidPassword } from "~/utils/zodForms";

const flags = vi.hoisted(() => ({ allowSignup: true }));

vi.mock("~/api/auth.api", () => ({
  confirmSignup: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("~/lib/runtimeConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/runtimeConfig")>();
  return {
    ...actual,
    getConfig: () => {
      const config = actual.getConfig();
      return {
        ...config,
        authentication: { ...config.authentication, allowSignup: flags.allowSignup },
      };
    },
  };
});

const PASSWORD = "AdaLovelace123!";

function Address() {
  const { pathname, hash } = useLocation();
  return <output aria-label="address">{pathname + hash}</output>;
}

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/signup/confirm" element={<SignupConfirmPage />} />
        <Route path="/login" element={<div>Sign-in page</div>} />
      </Routes>
      <Address />
    </MemoryRouter>,
  );
}

async function choosePassword(password: string, confirm = password) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Enter your new password"), password);
  await user.type(screen.getByPlaceholderText("Confirm your new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Set password" }));
  return user;
}

describe("SignupConfirmPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.allowSignup = true;
  });

  it("takes the token off the address at once", async () => {
    renderPage("/signup/confirm#the-token");

    await waitFor(() =>
      expect(screen.getByLabelText("address")).toHaveTextContent(/^\/signup\/confirm$/),
    );
    expect(
      screen.getByRole("heading", { name: "Choose your password" }),
    ).toBeInTheDocument();
  });

  it("creates the account with the link's token, then sends the user to sign in", async () => {
    vi.mocked(confirmSignup).mockResolvedValueOnce({ status: 200 });
    renderPage("/signup/confirm#the-token");

    const user = await choosePassword(PASSWORD);

    expect(confirmSignup).toHaveBeenCalledWith("the-token", PASSWORD);
    expect(
      await screen.findByText(
        "Your account is ready. Sign in with your email address and password.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Sign-in page")).toBeInTheDocument();
  });

  it("checks the password before it sends anything", async () => {
    renderPage("/signup/confirm#the-token");

    await choosePassword("weakpass");

    expect(await screen.findAllByText(invalidPassword)).toHaveLength(2);
    expect(confirmSignup).not.toHaveBeenCalled();
  });

  it("says what the API said about a used or expired link", async () => {
    vi.mocked(confirmSignup).mockResolvedValueOnce({
      status: 400,
      detail: "This link has expired or was used already. Sign up again.",
    });
    renderPage("/signup/confirm#used-token");

    await choosePassword(PASSWORD);

    expect(
      await screen.findByText(
        "This link has expired or was used already. Sign up again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Your account is ready/)).not.toBeInTheDocument();
  });

  it("asks for a new link when the address has no token", () => {
    renderPage("/signup/confirm");

    expect(
      screen.getByText("This link is not complete. Sign up again to get a new one."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set password" })).toBeDisabled();
  });

  it("sends the visitor to sign in when signup is off", () => {
    flags.allowSignup = false;
    renderPage("/signup/confirm#the-token");

    expect(screen.getByText("Sign-in page")).toBeInTheDocument();
    expect(confirmSignup).not.toHaveBeenCalled();
  });
});
