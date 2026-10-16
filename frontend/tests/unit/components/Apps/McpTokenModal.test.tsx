import { fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { McpTokenModal } from "~/components/Apps/McpTokenModal";

vi.mock("~/components/ds/atoms/Button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = "button",
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit";
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("~/components/ds/atoms/Input", () => ({
  Input: forwardRef<
    HTMLInputElement,
    {
      label?: string;
      value?: string;
      placeholder?: string;
      onChange?: (value: string) => void;
    }
  >(({ label, value, onChange, placeholder, ...rest }, ref) => (
    <label>
      <span>{label}</span>
      <input
        {...rest}
        ref={ref}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  )),
}));

vi.mock("~/components/ds/dialogs/Dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("~/components/ds/molecules/ConnectionTestResult", () => ({
  ConnectionTestResult: ({ message }: { message: string }) => (
    <div role="alert">{message}</div>
  ),
}));

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  serverName: "Demo MCP",
  vendorName: "Acme",
};

describe("McpTokenModal", () => {
  it("disables submit when the token is empty", () => {
    render(<McpTokenModal {...baseProps} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("passes the cleaned token to onSave", () => {
    const onSave = vi.fn();
    render(<McpTokenModal {...baseProps} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "abc123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onSave).toHaveBeenCalledWith("abc123");
  });

  it("strips a pasted 'Bearer ' prefix before saving", () => {
    const onSave = vi.fn();
    render(<McpTokenModal {...baseProps} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "Bearer  my-secret-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onSave).toHaveBeenCalledWith("my-secret-token");
  });

  it("shows replace copy and an empty, masked field when a token is saved", () => {
    render(<McpTokenModal {...baseProps} hasSavedToken={true} onSave={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Replace token" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
    // The saved value never comes back to the page: the field starts empty
    expect(screen.getByPlaceholderText("•••••••• (saved)")).toHaveValue("");
  });

  it("sends a new token to replace the saved one", () => {
    const onSave = vi.fn();
    render(<McpTokenModal {...baseProps} hasSavedToken={true} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Token"), {
      target: { value: "new-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(onSave).toHaveBeenCalledWith("new-token");
  });

  it("invokes onRemove when the token is removed", () => {
    const onRemove = vi.fn();
    render(
      <McpTokenModal
        {...baseProps}
        hasSavedToken={true}
        onSave={vi.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove token" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("surfaces a provided connection error", () => {
    render(
      <McpTokenModal
        {...baseProps}
        hasSavedToken={true}
        onSave={vi.fn()}
        error="Check that your token is valid and not expired."
      />,
    );

    expect(
      screen.getByText("Check that your token is valid and not expired."),
    ).toBeInTheDocument();
  });
});
