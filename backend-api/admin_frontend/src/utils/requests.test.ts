// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginRequest, LoginResult } from "utils/requests";

const API_URL = "https://api.panel.test";
const ADMIN = { email: "admin@panel.test", is_superuser: true };
const CREDENTIALS = { email: ADMIN.email, password: "Sign-in-test-1" };

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

function sentBody(call: Call): unknown {
  return JSON.parse(String(call.init.body));
}

async function signIn(request: LoginRequest): Promise<LoginResult> {
  const { apiLogin } = await import("utils/requests");
  return apiLogin(request);
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", API_URL);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("apiLogin (POST /login)", () => {
  it("shows the API's own reason for a 403", async () => {
    answerWith([403, { detail: "Only superusers can sign in to the admin panel" }]);
    expect(await signIn(CREDENTIALS)).toEqual({
      outcome: "refused",
      message: "Only superusers can sign in to the admin panel",
    });
  });

  it("shows the message of a 403 that has no detail", async () => {
    answerWith([403, { message: "User is not confirmed" }]);
    expect(await signIn(CREDENTIALS)).toEqual({
      outcome: "refused",
      message: "User is not confirmed",
    });
  });

  it("sends a user whose organization requires an authenticator to the web app", async () => {
    answerWith([
      202,
      { two_factor_required: true, message: "Two-factor authentication is required" },
    ]);
    expect(await signIn(CREDENTIALS)).toEqual({
      outcome: "refused",
      message:
        "Two-factor authentication is required. Sign in to the web app to set up an authenticator, then sign in here with its code.",
    });
  });

  it("asks for the authenticator code and sends it in the same POST /login body", async () => {
    const calls = answerWith(
      [202, { message: "Invalid TOTP token" }],
      [200, ADMIN],
      [200, ADMIN],
    );

    expect(await signIn(CREDENTIALS)).toEqual({ outcome: "code-needed" });
    expect(sentBody(calls[0])).toEqual({ ...CREDENTIALS, remember: true });

    expect(await signIn({ ...CREDENTIALS, totpToken: 12345 })).toEqual({
      outcome: "signed-in",
      user: ADMIN,
    });
    const [, login, session] = calls;
    expect(login.url).toBe(`${API_URL}/login`);
    expect(login.init.method).toBe("POST");
    expect(sentBody(login)).toEqual({ ...CREDENTIALS, remember: true, totp_token: 12345 });
    expect(session.url).toBe(`${API_URL}/session`);

    // The session is the API's HttpOnly cookie: every call rides it, and nothing is kept
    for (const call of calls) {
      expect(call.init.credentials).toBe("include");
      expect(call.init.headers).toMatchObject({ "X-Workspace-Client": "admin" });
      expect(call.init.headers).not.toHaveProperty("Authorization");
    }
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("refuses a wrong authenticator code with a clear message", async () => {
    answerWith([202, { message: "Invalid TOTP token" }]);
    expect(await signIn({ ...CREDENTIALS, totpToken: 111111 })).toEqual({
      outcome: "refused",
      message: "That authenticator code is not valid. Enter the current code.",
    });
  });

  it.each([
    [401, { detail: "Incorrect username or password" }, "Incorrect username or password"],
    [
      422,
      { detail: [{ loc: ["body", "email"], msg: "Invalid email or username" }] },
      "The email, password or code sent is not valid.",
    ],
    [
      429,
      { error: "Rate limit exceeded: 5 per 1 minute" },
      "Too many sign-in attempts. Wait a minute and try again.",
    ],
    [500, { detail: "Internal Server Error" }, "Internal Server Error"],
  ])("explains a %i", async (status, body, message) => {
    answerWith([status, body]);
    expect(await signIn(CREDENTIALS)).toEqual({ outcome: "refused", message });
  });
});
