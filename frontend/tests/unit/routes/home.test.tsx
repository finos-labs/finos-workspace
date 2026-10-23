import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "~/routes/home";
import { makeAuthUser } from "../factories";
import { stubStoreState } from "../mocks";

const mockNavigate = vi.fn();

const LOGGED_IN_USER = makeAuthUser({ email: "test@test.com" });

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("~/lib/state/auth", () => ({
  useShallowAuthStore: vi.fn(),
}));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /app when user is logged in", async () => {
    const { useShallowAuthStore } = await import("~/lib/state/auth");
    stubStoreState(useShallowAuthStore, { user: LOGGED_IN_USER });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>,
    );

    expect(mockNavigate).toHaveBeenCalledWith("/app", { replace: true });
  });

  it("redirects to /login when user is not logged in", async () => {
    const { useShallowAuthStore } = await import("~/lib/state/auth");
    stubStoreState(useShallowAuthStore, { user: null });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>,
    );

    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("issues the redirect once, even across re-renders", async () => {
    const { useShallowAuthStore } = await import("~/lib/state/auth");
    stubStoreState(useShallowAuthStore, { user: LOGGED_IN_USER });

    const { rerender } = render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>,
    );
    rerender(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>,
    );

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("replaces the entry for / instead of pushing", async () => {
    const { useShallowAuthStore } = await import("~/lib/state/auth");
    stubStoreState(useShallowAuthStore, { user: LOGGED_IN_USER });

    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>,
    );

    expect(mockNavigate).toHaveBeenCalledWith("/app", { replace: true });
  });

  it("renders null (no visible content)", async () => {
    const { useShallowAuthStore } = await import("~/lib/state/auth");
    stubStoreState(useShallowAuthStore, { user: null });

    const { container } = render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>,
    );

    expect(container.innerHTML).toBe("");
  });
});
