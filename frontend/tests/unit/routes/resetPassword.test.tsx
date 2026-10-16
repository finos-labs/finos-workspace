import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPassword } from "~/api/auth.api";
import ResetPasswordPage from "~/routes/resetPassword";
import { invalidPassword } from "~/utils/zodForms";

vi.mock("~/api/auth.api", () => ({
  resetPassword: vi.fn(),
}));

const NEW_PASSWORD = "NewPassword456!";

function Address() {
  const { pathname, hash } = useLocation();
  return <output aria-label="address">{pathname + hash}</output>;
}

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Sign-in page</div>} />
      </Routes>
      <Address />
    </MemoryRouter>,
  );
}

/** The page in a data router, as the app has it, which a test can navigate. */
function renderRouter(entry: string) {
  const router = createMemoryRouter(
    [{ path: "/reset-password", element: <ResetPasswordPage /> }],
    { initialEntries: [entry] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

async function setPassword(password: string, confirm = password) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Enter your new password"), password);
  await user.type(screen.getByPlaceholderText("Confirm your new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Set password" }));
  return user;
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("takes the token off the address at once", async () => {
    renderPage("/reset-password#the-token");

    await waitFor(() =>
      expect(screen.getByLabelText("address")).toHaveTextContent(/^\/reset-password$/),
    );
    expect(
      screen.getByRole("heading", { name: "Set a new password" }),
    ).toBeInTheDocument();
    expect(screen.getByText(invalidPassword)).toBeInTheDocument();
  });

  it("sets the password with the link's token, then sends the user to sign in", async () => {
    vi.mocked(resetPassword).mockResolvedValueOnce({ status: 200 });
    renderPage("/reset-password#the-token");

    const user = await setPassword(NEW_PASSWORD);

    expect(resetPassword).toHaveBeenCalledWith("the-token", NEW_PASSWORD);
    expect(
      await screen.findByText("Your password is set. Sign in with it."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Sign-in page")).toBeInTheDocument();
  });

  it("checks the password before it sends anything", async () => {
    renderPage("/reset-password#the-token");

    await setPassword("weakpass");

    // The rule shows once per field, and the standing hint gives way
    expect(await screen.findAllByText(invalidPassword)).toHaveLength(2);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("checks that the two passwords match", async () => {
    renderPage("/reset-password#the-token");

    await setPassword(NEW_PASSWORD, "OtherPassword789!");

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("says what the API said about a used or expired link", async () => {
    vi.mocked(resetPassword).mockResolvedValueOnce({
      status: 400,
      detail:
        "This link has expired or was used already. Ask your admin for a new one.",
    });
    renderPage("/reset-password#used-token");

    await setPassword(NEW_PASSWORD);

    expect(
      await screen.findByText(
        "This link has expired or was used already. Ask your admin for a new one.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Your password is set. Sign in with it."),
    ).not.toBeInTheDocument();
  });

  it("says when there are too many tries", async () => {
    vi.mocked(resetPassword).mockResolvedValueOnce({ status: 429 });
    renderPage("/reset-password#the-token");

    await setPassword(NEW_PASSWORD);

    expect(
      await screen.findByText("Too many requests. Please try again later."),
    ).toBeInTheDocument();
  });

  it("takes the token of a link opened in a tab already on the page", async () => {
    vi.mocked(resetPassword)
      .mockResolvedValueOnce({ status: 400, detail: "This link has expired." })
      .mockResolvedValueOnce({ status: 200 });
    const { router } = renderRouter("/reset-password#old-token");
    await setPassword(NEW_PASSWORD);
    expect(await screen.findByText("This link has expired.")).toBeInTheDocument();

    // The admin's new link, pasted into the same tab: only the fragment changes
    await act(() => router.navigate("/reset-password#new-token"));
    await waitFor(() => expect(router.state.location.hash).toBe(""));
    expect(screen.queryByText("This link has expired.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));

    expect(resetPassword).toHaveBeenLastCalledWith("new-token", NEW_PASSWORD);
    expect(
      await screen.findByText("Your password is set. Sign in with it."),
    ).toBeInTheDocument();
  });

  it("asks for a new link when the address has no token", () => {
    renderPage("/reset-password");

    expect(
      screen.getByText("This link is not complete. Ask your admin for a new one."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set password" })).toBeDisabled();
  });
});
