import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "~/components/ds/dialogs/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title, description and actions", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Confirm Action"
        description="Are you sure?"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Confirm Action")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        onConfirm={() => {}}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders custom confirm button", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Title"
        confirmButton={<button>Custom Action</button>}
      />,
    );
    expect(screen.getByText("Custom Action")).toBeInTheDocument();
  });
});

vi.mock("./BaseDialog", () => ({
  BaseDialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => (
    <div data-testid="base-dialog">{open && children}</div>
  ),
}));

vi.mock("./Dialog", () => ({
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <footer>{children}</footer>,
  DialogClose: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../atoms/Button", () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock("../utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));
