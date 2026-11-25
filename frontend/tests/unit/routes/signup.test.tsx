import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestSignup } from "~/api/auth.api";
import SignupPage from "~/routes/signup";

const flags = vi.hoisted(() => ({ allowSignup: true }));

vi.mock("~/api/auth.api", () => ({
  requestSignup: vi.fn(),
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/signup"]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<div>Sign-in page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fill(email: string, first = "", last = "") {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Email address"), email);
  if (first)
    await user.type(screen.getByPlaceholderText("First name (optional)"), first);
  if (last) await user.type(screen.getByPlaceholderText("Last name (optional)"), last);
  await user.click(screen.getByRole("button", { name: "Send the link" }));
  return user;
}

describe("SignupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.allowSignup = true;
  });

  it("sends the address and the names, then says the link is on its way", async () => {
    vi.mocked(requestSignup).mockResolvedValueOnce({ status: 202 });
    renderPage();

    await fill("ada@example.com", " Ada ", "Lovelace");

    expect(requestSignup).toHaveBeenCalledWith("ada@example.com", "Ada", "Lovelace");
    expect(
      await screen.findByText(/If ada@example\.com can get an account/),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Email address")).not.toBeInTheDocument();
  });

  it("sends the names empty when they are left out", async () => {
    vi.mocked(requestSignup).mockResolvedValueOnce({ status: 202 });
    renderPage();

    await fill("ada@example.com");

    expect(requestSignup).toHaveBeenCalledWith("ada@example.com", "", "");
  });

  it("checks the address before it sends anything", async () => {
    renderPage();

    await fill("ada@example");

    expect(await screen.findByText("Invalid email")).toBeInTheDocument();
    expect(requestSignup).not.toHaveBeenCalled();
  });

  it("sends nothing for text that is not an address at all", async () => {
    renderPage();

    await fill("not-an-address");

    expect(requestSignup).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Email address")).toBeInTheDocument();
  });

  it.each([
    [403, "Registration is disabled."],
    [404, "Signup is not available."],
    [429, "Too many requests. Please try again later."],
    [503, "Signup is not set up. Ask your admin."],
    [500, "An unexpected error occurred."],
  ])("says what a %i answer means", async (status, message) => {
    vi.mocked(requestSignup).mockResolvedValueOnce({ status });
    renderPage();

    await fill("ada@example.com");

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Email address")).toBeInTheDocument();
  });

  it("goes back to sign in", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));

    expect(screen.getByText("Sign-in page")).toBeInTheDocument();
  });

  it("sends the visitor to sign in when signup is off", () => {
    flags.allowSignup = false;
    renderPage();

    expect(screen.getByText("Sign-in page")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Email address")).not.toBeInTheDocument();
  });
});
