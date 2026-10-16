// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const API_URL = "https://api.panel.test";
const ADMIN = { email: "admin@panel.test", is_superuser: true };
const PASSWORD = "Sign-in-test-1";

interface Call {
  url: string;
  init: RequestInit;
}

/** Answers the panel's requests in turn with `answers` ([status, body]) and records them. */
function answerWith(...answers: Array<[number, unknown]>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = answers.shift();
      if (next === undefined) throw new Error(`Unexpected request to ${url}`);
      const [status, body] = next;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

async function renderSignIn(): Promise<void> {
  const { default: Login } = await import("routes/login");
  render(
    <MemoryRouter
      initialEntries={["/login"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<p>Entities page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function signInButton(): HTMLElement {
  return screen.getByRole("button", { name: "Sign In" });
}

function submitWith(email: string, password: string): void {
  type("Email", email);
  type("Password", password);
  fireEvent.click(signInButton());
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API_URL);
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the sign-in page", () => {
  it("asks for the authenticator code and signs in with it", async () => {
    const calls = answerWith(
      [202, { message: "Invalid TOTP token" }],
      [200, ADMIN],
      [200, ADMIN],
    );
    await renderSignIn();
    expect(screen.queryByLabelText("Authenticator code")).toBeNull();

    submitWith(ADMIN.email, PASSWORD);
    const code = await screen.findByLabelText("Authenticator code");
    expect(document.activeElement).toBe(code);
    expect(screen.queryByText("Unknown error occurred")).toBeNull();

    // No request goes out until the code is six digits
    fireEvent.click(signInButton());
    await screen.findByText("Enter the 6-digit code from your authenticator app");
    expect(calls).toHaveLength(1);

    type("Authenticator code", "012 345");
    fireEvent.click(signInButton());
    await screen.findByText("Entities page");

    expect(calls[1].url).toBe(`${API_URL}/login`);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      email: ADMIN.email,
      password: PASSWORD,
      remember: true,
      totp_token: 12345,
    });
    expect(calls[2].url).toBe(`${API_URL}/session`);
  });

  it("shows a wrong code's refusal and keeps asking for the code", async () => {
    answerWith([202, { message: "Invalid TOTP token" }], [202, { message: "Invalid TOTP token" }]);
    await renderSignIn();
    submitWith(ADMIN.email, PASSWORD);
    await screen.findByLabelText("Authenticator code");

    type("Authenticator code", "111111");
    fireEvent.click(signInButton());

    await screen.findByText("That authenticator code is not valid. Enter the current code.");
    expect(screen.getByLabelText("Authenticator code")).toHaveProperty("value", "");
  });

  it("shows the API's own reason for a 403", async () => {
    answerWith([403, { detail: "Only superusers can sign in to the admin panel" }]);
    await renderSignIn();
    submitWith(ADMIN.email, PASSWORD);

    await screen.findByText("Only superusers can sign in to the admin panel");
    expect(screen.queryByText(/Account not confirmed/)).toBeNull();
  });

  it("sends a user who must set up an authenticator to the web app", async () => {
    answerWith([
      202,
      { two_factor_required: true, message: "Two-factor authentication is required" },
    ]);
    await renderSignIn();
    submitWith(ADMIN.email, PASSWORD);

    await screen.findByText(
      "Two-factor authentication is required. Sign in to the web app to set up an authenticator, then sign in here with its code.",
    );
    expect(screen.queryByLabelText("Authenticator code")).toBeNull();
  });
});
