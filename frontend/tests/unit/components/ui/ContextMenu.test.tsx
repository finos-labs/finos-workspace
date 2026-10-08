import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "~/components/ui/ContextMenu";

describe("ContextMenu", () => {
  it("renders trigger and opens content on right click", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Item 1</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    const trigger = screen.getByText("Right click me");
    fireEvent.contextMenu(trigger);

    expect(screen.getByText("Item 1")).toBeInTheDocument();
  });
});

vi.mock("@radix-ui/react-context-menu", () => {
  const React = require("react");
  return {
    Root: ({ children }: { children?: ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      return (
        <div onContextMenu={() => setOpen(true)}>
          {React.Children.map(children, (child: ReactElement) => {
            if (
              (child.type as { displayName?: string }).displayName ===
              "ContextMenuContent"
            ) {
              return open ? child : null;
            }
            return child;
          })}
        </div>
      );
    },
    Trigger: ({ children }: { children?: ReactNode }) => (
      <div data-testid="trigger">{children}</div>
    ),
    Portal: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Content: ({ children }: { children?: ReactNode }) => (
      <div data-testid="content">{children}</div>
    ),
    Item: ({ children }: { children?: ReactNode }) => (
      <div data-testid="item">{children}</div>
    ),
    Group: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Sub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    RadioGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SubTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SubContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    CheckboxItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    RadioItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Label: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ItemIndicator: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Separator: () => <div />,
  };
});
