import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import AddUsersSelect from "~/components/AdminRoles/AddUsersSelect";

vi.mock("@radix-ui/react-dropdown-menu", () => {
  const React = require("react");
  const DropdownContext = React.createContext({
    open: false,
    setOpen: (_: boolean) => {},
  });

  return {
    Root: ({
      children,
      open: openProp,
      onOpenChange,
    }: {
      children?: ReactNode;
      open?: boolean;
      onOpenChange: (open: boolean) => void;
    }) => {
      const [openLocal, setOpenLocal] = React.useState(false);
      const open = openProp ?? openLocal;
      const setOpen = (next: boolean) => {
        setOpenLocal(next);
        onOpenChange?.(next);
      };
      return (
        <DropdownContext.Provider value={{ open, setOpen }}>
          {children}
        </DropdownContext.Provider>
      );
    },
    Trigger: ({
      children,
      asChild,
      disabled,
      ...rest
    }: ComponentProps<"button"> & { asChild?: boolean }) => {
      const { setOpen } = React.useContext(DropdownContext);
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen(true)}
          {...rest}
        >
          {children}
        </button>
      );
    },
    Portal: ({ children }: { children?: ReactNode }) => {
      const { open } = React.useContext(DropdownContext);
      return open ? children : null;
    },
    Content: ({
      children,
      className,
    }: {
      children?: ReactNode;
      className?: string;
    }) => (
      <div data-testid="dropdown-content" className={className}>
        {children}
      </div>
    ),
    Group: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Sub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SubTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SubContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    RadioGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    CheckboxItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    RadioItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Label: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Separator: () => <hr />,
    ItemIndicator: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("~/components/Icon", () => ({
  default: ({ id }: { id: string }) => <span data-testid={`icon-${id}`} />,
}));

const users = [
  { name: "Alice Admin", email: "alice@example.com" },
  { name: "Alex Apple", email: "alex@example.com" },
  { name: "Bob Builder", email: "bob@example.com" },
];

function setup(extra?: {
  value?: string[];
  onChange?: (v: string[]) => void;
  isLoading?: boolean;
}) {
  const onChange = extra?.onChange ?? vi.fn();
  render(
    <AddUsersSelect
      entityUsers={users}
      value={extra?.value ?? []}
      onChange={onChange}
      isLoading={extra?.isLoading ?? false}
    />,
  );
  const trigger = screen.getAllByRole("button")[0];
  return { trigger, onChange };
}

function openDropdownAndSearch(query?: string) {
  fireEvent.click(screen.getAllByRole("button")[0]);
  if (query !== undefined) {
    const search = screen.getByPlaceholderText("Search users");
    fireEvent.change(search, { target: { value: query } });
  }
}

describe("AddUsersSelect", () => {
  describe("trigger label", () => {
    it("reads 'Add members' when no users are selected", () => {
      const { trigger } = setup({ value: [] });
      expect(trigger).toHaveTextContent("Add members");
    });

    it("reads '1 member selected' for a singular selection", () => {
      const { trigger } = setup({ value: ["alice@example.com"] });
      expect(trigger).toHaveTextContent("1 member selected");
    });

    it("reads 'N members selected' for plural selection", () => {
      const { trigger } = setup({
        value: ["alice@example.com", "bob@example.com"],
      });
      expect(trigger).toHaveTextContent("2 members selected");
    });

    it("reads 'Loading users…' and is disabled when isLoading", () => {
      const { trigger } = setup({ isLoading: true });
      expect(trigger).toHaveTextContent("Loading users…");
      expect(trigger).toBeDisabled();
    });
  });

  describe("Select-all respects the search filter", () => {
    it("adds only the filtered users to existing value when checking Select all", () => {
      const onChange = vi.fn();
      setup({ value: ["bob@example.com"], onChange });

      openDropdownAndSearch("al");

      const selectAll = screen.getByLabelText("Select all");
      fireEvent.click(selectAll);

      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0] as string[];
      expect(new Set(next)).toEqual(
        new Set(["bob@example.com", "alice@example.com", "alex@example.com"]),
      );
    });

    it("removes only the filtered users from value when unchecking Select all", () => {
      const onChange = vi.fn();
      setup({
        value: ["alice@example.com", "alex@example.com", "bob@example.com"],
        onChange,
      });

      openDropdownAndSearch("al");

      const selectAll = screen.getByLabelText("Select all");
      fireEvent.click(selectAll);

      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0] as string[];
      expect(next).toEqual(["bob@example.com"]);
    });
  });

  describe("Select-all checkbox tri-state", () => {
    it("is unchecked when no filtered users are selected", () => {
      setup({ value: [] });
      openDropdownAndSearch();
      const selectAll = screen.getByLabelText("Select all");
      expect(selectAll).toHaveAttribute("data-state", "unchecked");
    });

    it("is indeterminate when some (but not all) filtered users are selected", () => {
      setup({ value: ["alice@example.com"] });
      openDropdownAndSearch();
      const selectAll = screen.getByLabelText("Select all");
      expect(selectAll).toHaveAttribute("data-state", "indeterminate");
    });

    it("is checked when every filtered user is selected", () => {
      setup({
        value: ["alice@example.com", "alex@example.com", "bob@example.com"],
      });
      openDropdownAndSearch();
      const selectAll = screen.getByLabelText("Select all");
      expect(selectAll).toHaveAttribute("data-state", "checked");
    });
  });

  describe("empty states", () => {
    it("renders a 'No users found' status for an empty search result", () => {
      setup();
      openDropdownAndSearch("zzzzzz");

      const status = screen.getByRole("status");
      expect(within(status).getByText(/No users found/i)).toBeInTheDocument();
    });
  });
});
