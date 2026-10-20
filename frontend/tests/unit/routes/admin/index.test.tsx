import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminHome, { RenderNoData } from "~/routes/admin/index";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("~/lib/state/auth", () => ({
  useAuthStore: vi.fn(() => ({ user: null })),
}));

describe("AdminHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /admin/users when user is logged in", async () => {
    const { useAuthStore } = await import("~/lib/state/auth");
    vi.mocked(useAuthStore).mockReturnValue({ user: { email: "admin@test.com" } });

    render(
      <BrowserRouter>
        <AdminHome />
      </BrowserRouter>,
    );

    expect(mockNavigate).toHaveBeenCalledWith("/admin/users");
  });

  it("redirects to /login when user is not logged in", async () => {
    const { useAuthStore } = await import("~/lib/state/auth");
    vi.mocked(useAuthStore).mockReturnValue({ user: null });

    render(
      <BrowserRouter>
        <AdminHome />
      </BrowserRouter>,
    );

    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it("renders null (no visible content)", async () => {
    const { useAuthStore } = await import("~/lib/state/auth");
    vi.mocked(useAuthStore).mockReturnValue({ user: null });

    const { container } = render(
      <BrowserRouter>
        <AdminHome />
      </BrowserRouter>,
    );

    expect(container.innerHTML).toBe("");
  });
});

describe("RenderNoData", () => {
  it("shows nothing while the data loads: no loading animation", () => {
    const { container } = render(
      <RenderNoData isLoading={true} isError={false}>
        No rows yet
      </RenderNoData>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("says what is missing once the data is there", () => {
    render(
      <RenderNoData isLoading={false} isError={false}>
        No rows yet
      </RenderNoData>,
    );

    expect(screen.getByText("No rows yet")).toBeInTheDocument();
  });

  it("says that something went wrong", () => {
    render(
      <RenderNoData isLoading={false} isError={true}>
        No rows yet
      </RenderNoData>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
