import * as TabsPrimitive from "@radix-ui/react-tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  decideShareRequest,
  getShareRequests,
  type ShareRequest,
} from "~/api/admin.api";
import { ShareRequestsPage } from "~/components/AdminRoles/ShareRequestsPage";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock("~/api/admin.api", () => ({
  getShareRequests: vi.fn(),
  decideShareRequest: vi.fn(),
}));

const developer = { email: "dev@example.com", first_name: "Dana", last_name: "Dev" };
const colleague = { email: "colleague@example.com", first_name: null, last_name: null };

const dashboardRequest: ShareRequest = {
  uuid: "r1",
  created_date: "2026-10-16T10:00:00Z",
  requester: developer,
  item_type: "dashboard",
  item_uuid: "d1",
  item_name: "Quarterly figures",
  recipient: colleague,
  permissions: "view",
};

const organizationRequest: ShareRequest = {
  ...dashboardRequest,
  uuid: "r2",
  item_type: "app",
  item_uuid: "a1",
  item_name: "Screening app",
  recipient: null,
  permissions: null,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TabsPrimitive.Root value="share-requests">
        <ShareRequestsPage />
      </TabsPrimitive.Root>
    </QueryClientProvider>,
  );
}

const row = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

describe("ShareRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (decideShareRequest as Mock).mockResolvedValue({ success: true });
  });

  it("shows nothing while the requests load: no loading animation", () => {
    (getShareRequests as Mock).mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("lists what developers asked to share, and with whom", async () => {
    (getShareRequests as Mock).mockResolvedValue([
      dashboardRequest,
      organizationRequest,
    ]);
    renderPage();

    await screen.findByText("Quarterly figures");
    const dashboard = row("Quarterly figures");
    expect(
      within(dashboard).getByText("Dashboard:", { exact: false }),
    ).toBeInTheDocument();
    expect(within(dashboard).getByText("Dana Dev")).toBeInTheDocument();
    expect(within(dashboard).getByText("colleague@example.com")).toBeInTheDocument();

    const app = row("Screening app");
    expect(within(app).getByText("App:", { exact: false })).toBeInTheDocument();
    expect(within(app).getByText("Everyone in the organization")).toBeInTheDocument();
  });

  it.each([
    ["Approve", "approve", "Share approved"],
    ["Decline", "decline", "Share declined"],
  ])("%s decides the request", async (button, decision, message) => {
    (getShareRequests as Mock).mockResolvedValue([dashboardRequest]);
    renderPage();

    await screen.findByText("Quarterly figures");
    await userEvent.click(
      within(row("Quarterly figures")).getByRole("button", { name: button }),
    );

    await waitFor(() =>
      expect(decideShareRequest).toHaveBeenCalledWith("r1", decision),
    );
    expect(toastSuccess).toHaveBeenCalledWith(message);
    // The list is read again
    await waitFor(() => expect(getShareRequests).toHaveBeenCalledTimes(2));
  });

  it("says what went wrong when a request cannot be decided", async () => {
    (getShareRequests as Mock).mockResolvedValue([dashboardRequest]);
    (decideShareRequest as Mock).mockRejectedValue({
      response: { data: { detail: "The requester's roles no longer allow sharing" } },
    });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "The share request could not be decided",
        {
          description: "The requester's roles no longer allow sharing",
        },
      ),
    );
  });

  it("says when nothing waits", async () => {
    (getShareRequests as Mock).mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("No share requests")).toBeInTheDocument();
  });
});
