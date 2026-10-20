import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { getUserAppShares, getUserAppShareUsers, shareUserApp } from "~/api/auth.api";
import { ShareAppDialog } from "~/components/General/SharedAppsDialog";
import { useThemeStore } from "~/lib/state/theme";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock("~/api/auth.api", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  deleteUserAppShare: vi.fn(),
  getUserAppShares: vi.fn(),
  getUserAppShareUsers: vi.fn(),
  shareUserApp: vi.fn(),
}));

vi.mock("~/api/dashboard.api", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  saveDashboards: vi.fn(),
}));

const WAITING = "waiting@example.com";
const OTHER = "other@example.com";

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ShareAppDialog closeDialog={false} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("ShareAppDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ shareUserAppsPopupId: "a1" });
    (getUserAppShareUsers as Mock).mockResolvedValue({
      [WAITING]: { first_name: "Wai", last_name: "Ting", shared: false },
      [OTHER]: { first_name: "Oth", last_name: "Er", shared: false },
    });
    // A developer's share that waits for an admin
    (getUserAppShares as Mock).mockResolvedValue({
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

    const person = (await screen.findByText(WAITING)).closest(
      ".justify-between",
    ) as HTMLElement;
    expect(within(person).getByText("Waiting for approval")).toBeInTheDocument();
  });

  it("tells a developer that their share went to an admin", async () => {
    (shareUserApp as Mock).mockResolvedValue({ success: true, pending_approval: true });
    renderDialog();
    await screen.findByText(WAITING);

    await userEvent.click(screen.getByRole("button", { name: /1 user selected/ }));
    await userEvent.click(await screen.findByText(OTHER));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(shareUserApp).toHaveBeenCalledTimes(1));
    expect((shareUserApp as Mock).mock.calls[0][1].split(",").sort()).toEqual([
      OTHER,
      WAITING,
    ]);
    expect(toastSuccess).toHaveBeenCalledWith("Sent to an admin for approval", {
      description: "The people you chose get access once an admin approves the share.",
    });
  });
});
