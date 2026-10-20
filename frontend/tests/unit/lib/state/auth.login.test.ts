import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "~/lib/state/auth";
import { clearIdpTokens, getIdpTokens } from "~/lib/state/idpTokens";
import type { LoginResponse } from "~/types/auth.type";
import { type DeepPartial, partial } from "../../mocks";

vi.mock("~/api/auth.api", () => ({ getSession: vi.fn(), logout: vi.fn() }));

describe("useAuthStore - login", () => {
  const createMockLoginResponse = (
    overrides: DeepPartial<LoginResponse> = {},
  ): LoginResponse =>
    partial<LoginResponse>({
      email: "test@example.com",
      entity_name: "Test Entity",
      role: "user",
      uuid: "user-uuid-123",
      is_first_login: false,
      show_changelog: false,
      access: { user_type: "User", sharing: "none" },
      user: {
        first_name: "Test",
        last_name: "User",
        display_settings: { lastVisitedPage: "/app" },
      },
      ...overrides,
    });

  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      showChangelog: false,
      name: { first: "", last: "" },
      lastVisitedPage: "/app",
    });
    clearIdpTokens();
  });

  it("keeps the profile only", () => {
    useAuthStore.getState().login(createMockLoginResponse());

    expect(useAuthStore.getState().user).toEqual({
      email: "test@example.com",
      entity_name: "Test Entity",
      role: "user",
      uuid: "user-uuid-123",
    });
  });

  it("keeps the email in page memory for the identity headers", () => {
    useAuthStore.getState().login(createMockLoginResponse());

    expect(getIdpTokens().email).toBe("test@example.com");
  });

  it("sets the name from the user data", () => {
    useAuthStore.getState().login(
      createMockLoginResponse({
        user: { first_name: "John", last_name: "Doe", display_settings: {} },
      }),
    );

    expect(useAuthStore.getState().name).toEqual({ first: "John", last: "Doe" });
  });

  it("sets showChangelog from the response", () => {
    useAuthStore.getState().login(createMockLoginResponse({ show_changelog: true }));

    expect(useAuthStore.getState().showChangelog).toBe(true);
  });

  it("sets lastVisitedPage from the display settings and leaves it out of them", () => {
    const response = createMockLoginResponse({
      user: {
        first_name: "Test",
        last_name: "User",
        display_settings: { lastVisitedPage: "/app/explore", fontSize: "large" },
      },
    });

    useAuthStore.getState().login(response);

    expect(useAuthStore.getState().lastVisitedPage).toBe("/app/explore");
    expect(response.user.display_settings).toEqual({ fontSize: "large" });
  });

  it("lands on the apps page when no page was visited before", () => {
    useAuthStore.setState({ lastVisitedPage: "/app/settings" });

    useAuthStore.getState().login(
      createMockLoginResponse({
        user: { first_name: "Test", last_name: "User", display_settings: {} },
      }),
    );

    expect(useAuthStore.getState().lastVisitedPage).toBe("/app");
  });

  it("writes nothing to browser storage", () => {
    localStorage.clear();
    sessionStorage.clear();

    useAuthStore.getState().login(createMockLoginResponse());

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
