import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, inviteUser } from "~/api/admin.api";
import InviteSingleUser from "~/components/AdminUsers/InviteUser/InviteSingleUser";
import { Tabs } from "~/components/ds/molecules/Tabs";

vi.mock("~/components/ds/dialogs/Dialog", () => ({
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("~/api/admin.api", () => ({
  createUser: vi.fn(),
  inviteUser: vi.fn(),
}));

vi.mock("~/api/entity_roles.api", () => ({
  getEntityRoles: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useQueryClient: () => ({ refetchQueries: vi.fn() }),
}));

const LINK = "http://localhost:3000/reset-password#the-token";
const EXPIRES_AT = "2026-10-17T12:00:00Z";

function renderForm(onClose = vi.fn()) {
  render(
    <Tabs defaultValue="single">
      <InviteSingleUser permissions="user-map" onClose={onClose} />
    </Tabs>,
  );
  return onClose;
}

async function fillIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("First name"), "Jane");
  await user.type(screen.getByLabelText("Last name"), "Doe");
  await user.type(screen.getByLabelText("Email address"), "jane.doe@example.com");
  return user;
}

describe("InviteSingleUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the link a user added without an invitation sets their password with", async () => {
    vi.mocked(createUser).mockResolvedValueOnce({
      success: true,
      link: LINK,
      expires_at: EXPIRES_AT,
    });
    const onClose = renderForm();
    const user = await fillIn();

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByLabelText("Password link")).toHaveValue(LINK);
    expect(createUser).toHaveBeenCalledWith({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane.doe@example.com",
      permissions_uuid: "user-map",
      role: null,
    });
    expect(
      screen.getByText("Jane Doe has been added to the organization."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Give them this link to set their password. It works once, until ${new Date(EXPIRES_AT).toLocaleString()}.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/temporary password/i)).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    // The admin closes the dialog once the link is copied
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("invites a user when Bypass invitation is off", async () => {
    vi.mocked(inviteUser).mockResolvedValueOnce({ success: true });
    const onClose = renderForm();
    const user = await fillIn();
    await user.click(screen.getByRole("checkbox", { name: "Bypass invitation" }));

    await user.click(screen.getByRole("button", { name: "Invite" }));

    expect(inviteUser).toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("User invited", {
      description: "User Jane Doe has been invited.",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("says why the user was not added", async () => {
    vi.mocked(createUser).mockRejectedValueOnce({
      response: {
        status: 409,
        data: { detail: "A user with this email already exists" },
      },
    });
    const onClose = renderForm();
    const user = await fillIn();

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("A user with this email already exists"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password link")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
