import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { BaseDialog } from "~/components/ds/dialogs/BaseDialog";

describe("BaseDialog", () => {
  it("renders trigger and children", async () => {
    const user = userEvent.setup();
    render(
      <BaseDialog trigger={<button>Open</button>}>
        <div>Dialog content</div>
      </BaseDialog>,
    );

    const trigger = screen.getByText("Open");
    await user.click(trigger);

    expect(screen.getByText("Dialog content")).toBeInTheDocument();
  });

  it("calls onClose when dialog is closed", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <BaseDialog open={true} onClose={onClose}>
        <div>Content</div>
      </BaseDialog>,
    );

    rerender(
      <BaseDialog open={false} onClose={onClose}>
        <div>Content</div>
      </BaseDialog>,
    );
  });
});

vi.mock("./Dialog", () => {
  const React = require("react");
  const DialogContext = React.createContext({ onOpenChange: () => {} });

  return {
    Dialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children?: ReactNode;
      open?: boolean;
      onOpenChange: (open: boolean) => void;
    }) => {
      React.useEffect(() => {
        if (open === false) onOpenChange?.(false);
      }, [open]);
      return (
        <DialogContext.Provider value={{ onOpenChange }}>
          <div data-testid="dialog-root">{open && children}</div>
        </DialogContext.Provider>
      );
    },
    DialogTrigger: ({
      children,
      asChild,
      onClick,
    }: {
      children?: ReactNode;
      asChild?: boolean;
      onClick: () => void;
    }) => {
      const { onOpenChange } = React.useContext(DialogContext);
      return <div onClick={() => onOpenChange(true)}>{children}</div>;
    },
    DialogContent: ({
      children,
      className,
    }: {
      children?: ReactNode;
      className?: string;
    }) => (
      <div data-testid="dialog-content" className={className}>
        {children}
      </div>
    ),
  };
});
