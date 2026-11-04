import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  getDashboardShares,
  getDashboardShareUsers,
  shareDashboard,
} from "~/api/dashboard.api";
import { ShareDashboard } from "~/components/General/SharedDashboardDialog";
import { useThemeStore } from "~/lib/state/theme";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock("~/api/dashboard.api", () => ({
  deleteDashboardShare: vi.fn(),
  getDashboardShares: vi.fn(),
  getDashboardShareUsers: vi.fn(),
  saveDashboards: vi.fn(),
  shareDashboard: vi.fn(),
}));

const WAITING = "waiting@example.com";
const OTHER = "other@example.com";

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ShareDashboard closeDialog={false} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

const userRow = (email: string) =>
  screen.getByText(email).closest(".justify-between") as HTMLElement;

describe("ShareDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ shareDashboardPopupId: "d1" });
    (getDashboardShareUsers as Mock).mockResolvedValue({
      [WAITING]: { first_name: "Wai", last_name: "Ting", shared: false },
      [OTHER]: { first_name: "Oth", last_name: "Er", shared: false },
    });
    (getDashboardShares as Mock).mockResolvedValue({
      [WAITING]: {
        first_name: "Wai",
        last_name: "Ting",
        created_date: "2026-10-16T10:00:00Z",
        permissions: "view",
        pending: true,
      },
    });
  });

  it("marks the shares that wait for an admin's approval", async () => {
    renderDialog();

    await screen.findByText(WAITING);
    await waitFor(() =>
      expect(
        within(userRow(WAITING)).getByText("Waiting for approval"),
      ).toBeInTheDocument(),
    );
    expect(within(userRow(OTHER)).queryByText("Waiting for approval")).toBeNull();
  });

  it("tells a developer that their share went to an admin", async () => {
    (shareDashboard as Mock).mockResolvedValue({
      success: true,
      pending_approval: true,
    });
    renderDialog();
    await screen.findByText(OTHER);

    await userEvent.click(within(userRow(OTHER)).getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "View" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(shareDashboard).toHaveBeenCalledWith("d1", `${WAITING},${OTHER}`),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Sent to an admin for approval", {
      description: "The people you chose get access once an admin approves the share.",
    });
  });

  it("confirms a direct share as before", async () => {
    (shareDashboard as Mock).mockResolvedValue({
      success: true,
      pending_approval: false,
    });
    renderDialog();
    await screen.findByText(OTHER);

    await userEvent.click(within(userRow(OTHER)).getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "View" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Dashboard shared permissions updated"),
    );
  });
});
