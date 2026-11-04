import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ForwardedRef, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ds/dialogs/Dialog";

describe("Dialog", () => {
  it("renders trigger and opens content", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog Description</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByText("Open Dialog");
    await user.click(trigger);

    expect(screen.getByText("Dialog Title")).toBeInTheDocument();
    expect(screen.getByText("Dialog Description")).toBeInTheDocument();
  });
});

vi.mock("@radix-ui/react-dialog", () => {
  const React = require("react");
  const DialogContext = React.createContext({ open: false, setOpen: () => {} });

  return {
    Root: ({
      children,
      open: controlledOpen,
      onOpenChange,
    }: {
      children?: ReactNode;
      open?: boolean;
      onOpenChange: (open: boolean) => void;
    }) => {
      const [internalOpen, setInternalOpen] = React.useState(false);
      const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
      const setOpen = onOpenChange || setInternalOpen;
      return (
        <DialogContext.Provider value={{ open, setOpen }}>
          {children}
        </DialogContext.Provider>
      );
    },
    Trigger: ({ children }: { children?: ReactNode }) => {
      const { setOpen } = React.useContext(DialogContext);
      return <div onClick={() => setOpen(true)}>{children}</div>;
    },
    Portal: ({ children }: { children?: ReactNode }) => {
      const { open } = React.useContext(DialogContext);
      return open ? children : null;
    },
    Content: React.forwardRef(
      (
        { children, className }: { children?: ReactNode; className?: string },
        ref: ForwardedRef<HTMLDivElement>,
      ) => (
        <div ref={ref} className={className}>
          {children}
        </div>
      ),
    ),
    Overlay: ({ className }: { className?: string }) => <div className={className} />,
    Title: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <h2 className={className}>{children}</h2>
    ),
    Description: ({
      children,
      className,
    }: {
      children?: ReactNode;
      className?: string;
    }) => <p className={className}>{children}</p>,
    Close: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <span className={className}>{children}</span>
    ),
  };
});

vi.mock("~/components/Icon", () => ({
  default: () => <div data-testid="icon" />,
}));

vi.mock("../atoms/Button", () => ({
  Button: ({
    children,
    onClick,
    className,
  }: {
    children?: ReactNode;
    onClick: () => void;
    className?: string;
  }) => (
    <button onClick={onClick} className={className}>
      {children}
    </button>
  ),
}));

vi.mock("../utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));
