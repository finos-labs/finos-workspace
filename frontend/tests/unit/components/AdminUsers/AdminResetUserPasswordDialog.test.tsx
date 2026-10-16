import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { resetUserPassword } from "~/api/admin.api";
import AdminResetUserPasswordDialog from "~/components/AdminUsers/AdminResetUserPasswordDialog";
import { makeUser } from "../../factories";

vi.mock("~/api/admin.api", () => ({
  resetUserPassword: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const LINK = "http://localhost:3000/reset-password#the-token";
const EXPIRES_AT = "2026-10-17T12:00:00Z";

describe("AdminResetUserPasswordDialog", () => {
  const mockUser = makeUser({ uuid: "123", email: "test@example.com" });

  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    user: mockUser,
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks before it resets the password", () => {
    render(<AdminResetUserPasswordDialog {...defaultProps} />);

    expect(
      screen.getByText(
        `Are you sure you want to reset the password for this account ${mockUser.email}?`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Yes, reset password")).toBeInTheDocument();
    expect(resetUserPassword).not.toHaveBeenCalled();
  });

  it("shows the link to give the user, and when it stops working", async () => {
    vi.mocked(resetUserPassword).mockResolvedValueOnce({
      success: true,
      link: LINK,
      expires_at: EXPIRES_AT,
    });

    render(<AdminResetUserPasswordDialog {...defaultProps} />);
    fireEvent.click(screen.getByText(/Yes, reset password/i));

    expect(await screen.findByLabelText("Password link")).toHaveValue(LINK);
    expect(resetUserPassword).toHaveBeenCalledWith(mockUser.uuid);
    expect(
      screen.getByText(
        `The password of ${mockUser.email} no longer works, and every session of the account has ended.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Give them this link to set their password. It works once, until ${new Date(EXPIRES_AT).toLocaleString()}.`,
      ),
    ).toBeInTheDocument();
    expect(defaultProps.onConfirm).toHaveBeenCalled();
    // The admin closes the dialog once the link is copied
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Yes, reset password")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Done"));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("shows error toast on reset password failure", async () => {
    const error = new AxiosError("Error resetting user password");
    (resetUserPassword as Mock).mockRejectedValueOnce(error);

    render(<AdminResetUserPasswordDialog {...defaultProps} />);

    const resetButton = screen.getByText(/Yes, reset password/i);
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Error resetting user password", {
        description: "Error resetting user password",
      });
    });
    expect(screen.queryByLabelText("Password link")).not.toBeInTheDocument();
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  it("closes dialog when cancel is clicked", () => {
    render(<AdminResetUserPasswordDialog {...defaultProps} />);

    const cancelButton = screen.getByText(/Cancel/i);
    fireEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
