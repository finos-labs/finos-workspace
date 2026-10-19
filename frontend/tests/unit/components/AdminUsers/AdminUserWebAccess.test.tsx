import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminUserWebAccess from "~/components/AdminUsers/AdminUserWebAccess";

const h = vi.hoisted(() => ({
  getUserWebAccess: vi.fn(),
  patchUserWebAccess: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("~/api/admin.api", () => ({
  getUserWebAccess: h.getUserWebAccess,
  patchUserWebAccess: h.patchUserWebAccess,
}));

vi.mock("sonner", () => ({ toast: h.toast }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const search = () => screen.getByRole("checkbox", { name: /search the web/i });
const fetchPages = () =>
  screen.getByRole("checkbox", { name: /read pages from the web/i });

describe("AdminUserWebAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getUserWebAccess.mockResolvedValue({ search_web: true, fetch_from_web: true });
    h.patchUserWebAccess.mockResolvedValue({ success: true });
  });

  it("shows both tools as on for a user who has them", async () => {
    render(<AdminUserWebAccess userUuid="u-1" />, { wrapper });

    await waitFor(() => expect(search()).not.toBeDisabled());
    expect(search()).toBeChecked();
    expect(fetchPages()).toBeChecked();
    expect(h.getUserWebAccess).toHaveBeenCalledWith("u-1");
  });

  it("shows what is switched off as off, and what was never set as on", async () => {
    h.getUserWebAccess.mockResolvedValue({ search_web: false, fetch_from_web: null });
    render(<AdminUserWebAccess userUuid="u-1" />, { wrapper });

    await waitFor(() => expect(search()).not.toBeDisabled());
    expect(search()).not.toBeChecked();
    expect(fetchPages()).toBeChecked();
  });

  it("switches one tool off for the user with that one change, and says so", async () => {
    render(<AdminUserWebAccess userUuid="u-1" />, { wrapper });
    await waitFor(() => expect(search()).not.toBeDisabled());

    fireEvent.click(search());

    await waitFor(() =>
      expect(h.patchUserWebAccess).toHaveBeenCalledWith("u-1", { search_web: false }),
    );
    await waitFor(() =>
      expect(h.toast.success).toHaveBeenCalledWith("Web access updated"),
    );
  });

  it("switches a tool back on", async () => {
    h.getUserWebAccess.mockResolvedValue({ search_web: true, fetch_from_web: false });
    render(<AdminUserWebAccess userUuid="u-1" />, { wrapper });
    await waitFor(() => expect(fetchPages()).not.toBeDisabled());

    fireEvent.click(fetchPages());

    await waitFor(() =>
      expect(h.patchUserWebAccess).toHaveBeenCalledWith("u-1", {
        fetch_from_web: true,
      }),
    );
  });

  it("cannot be changed while it is loading", () => {
    h.getUserWebAccess.mockReturnValue(new Promise(() => {}));
    render(<AdminUserWebAccess userUuid="u-1" />, { wrapper });

    expect(search()).toBeDisabled();
    expect(fetchPages()).toBeDisabled();
  });

  it("says there is nothing to set for a user without an entitlement", async () => {
    h.getUserWebAccess.mockRejectedValue(new Error("404"));
    render(<AdminUserWebAccess userUuid="u-1" />, { wrapper });

    expect(await screen.findByTestId("web-access-unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows the reason when the change is refused", async () => {
    h.patchUserWebAccess.mockRejectedValue({
      response: { data: { detail: "Not allowed" } },
    });
    render(<AdminUserWebAccess userUuid="u-1" />, { wrapper });
    await waitFor(() => expect(search()).not.toBeDisabled());

    fireEvent.click(search());

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Not allowed"));
  });
});
