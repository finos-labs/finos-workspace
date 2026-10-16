import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import EllipsisDropdownMenu from "~/components/EllipsisDropdown";
import type { EllipsisDropdownMenuProps } from "~/components/MoveToDropDown/types";
import { setAccess } from "../factories";

// The deployment has the Excel add-in; the menu reads the switch when it loads
vi.hoisted(() => vi.stubEnv("VITE_EXCEL_ADD_IN_ENABLED", "true"));

const widgetContext = vi.hoisted(() => ({
  widgetRef: {
    current: {
      id: "test-widget",
      widgetId: "test-widget",
      name: "Test Widget",
      type: "table",
      connectionType: undefined as string | undefined,
    },
  },
  activeDashboardId: "dashboard-1",
  isShared: false,
}));

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: vi.fn(() => widgetContext),
}));

vi.mock("~/lib/state/app", () => ({
  useAppStore: {
    getState: () => ({
      getTabWidgetById: vi.fn(),
      duplicateWidget: vi.fn(),
    }),
  },
}));

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: vi.fn(() => vi.fn()),
}));

vi.mock("~/components/MoveToDropDown", () => ({
  MoveToTabsDropdownMenu: () => <div data-testid="move-to-tabs">Move</div>,
}));

describe("EllipsisDropdownMenu", () => {
  const defaultProps: EllipsisDropdownMenuProps = {
    dispatch: vi.fn(),
    settings: {},
  };

  beforeEach(() => {
    widgetContext.widgetRef.current.connectionType = undefined;
    setAccess();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("renders the ellipsis trigger button", () => {
    render(<EllipsisDropdownMenu {...defaultProps} />);

    const trigger = screen.getByRole("button");
    expect(trigger).toBeInTheDocument();
  });

  describe("Minimize menu item", () => {
    it("shows minimize option when showMinimize is true and onMinimizeToggle is provided", async () => {
      const user = userEvent.setup();
      const onMinimizeToggle = vi.fn();

      render(
        <EllipsisDropdownMenu
          {...defaultProps}
          settings={{ showMinimize: true }}
          onMinimizeToggle={onMinimizeToggle}
          isMinimized={false}
        />,
      );

      const trigger = screen.getByRole("button");
      await user.click(trigger);

      expect(screen.getByText("Minimize")).toBeInTheDocument();
    });

    it("shows expand option when widget is minimized", async () => {
      const user = userEvent.setup();
      const onMinimizeToggle = vi.fn();

      render(
        <EllipsisDropdownMenu
          {...defaultProps}
          settings={{ showMinimize: true }}
          onMinimizeToggle={onMinimizeToggle}
          isMinimized={true}
        />,
      );

      const trigger = screen.getByRole("button");
      await user.click(trigger);

      expect(screen.getByText("Expand")).toBeInTheDocument();
    });

    it("calls onMinimizeToggle when minimize menu item is clicked", async () => {
      const user = userEvent.setup();
      const onMinimizeToggle = vi.fn();

      render(
        <EllipsisDropdownMenu
          {...defaultProps}
          settings={{ showMinimize: true }}
          onMinimizeToggle={onMinimizeToggle}
          isMinimized={false}
        />,
      );

      const trigger = screen.getByRole("button");
      await user.click(trigger);

      const minimizeItem = screen.getByText("Minimize");
      await user.click(minimizeItem);

      expect(onMinimizeToggle).toHaveBeenCalledTimes(1);
    });

    it("does not show minimize option when showMinimize is false", async () => {
      const user = userEvent.setup();
      const onMinimizeToggle = vi.fn();

      render(
        <EllipsisDropdownMenu
          {...defaultProps}
          settings={{ showMinimize: false }}
          onMinimizeToggle={onMinimizeToggle}
          isMinimized={false}
        />,
      );

      const trigger = screen.getByRole("button");
      await user.click(trigger);

      expect(screen.queryByText("Minimize")).not.toBeInTheDocument();
      expect(screen.queryByText("Expand")).not.toBeInTheDocument();
    });

    it("does not show minimize option when onMinimizeToggle is not provided", async () => {
      const user = userEvent.setup();

      render(
        <EllipsisDropdownMenu
          {...defaultProps}
          settings={{ showMinimize: true }}
          isMinimized={false}
        />,
      );

      const trigger = screen.getByRole("button");
      await user.click(trigger);

      expect(screen.queryByText("Minimize")).not.toBeInTheDocument();
    });
  });

  describe("Export and Excel formula", () => {
    const openMenu = async (settings: EllipsisDropdownMenuProps["settings"]) => {
      render(<EllipsisDropdownMenu {...defaultProps} settings={settings} />);
      await userEvent.setup().click(screen.getByRole("button"));
    };

    it("offers Export to every user", async () => {
      await openMenu({ showExport: true });

      expect(screen.getByText("Export")).toBeInTheDocument();
    });

    it("offers the Excel formula of a backend widget when a role grants the Excel add-in", async () => {
      setAccess({ excel_add_in: true });
      widgetContext.widgetRef.current.connectionType = "advanced-backend";
      await openMenu({ showFunctions: true });

      expect(screen.getByText("Excel formula")).toBeInTheDocument();
    });

    it("does not offer the Excel formula when no role grants the Excel add-in", async () => {
      setAccess({ excel_add_in: false });
      widgetContext.widgetRef.current.connectionType = "advanced-backend";
      await openMenu({ showFunctions: true });

      expect(screen.queryByText("Excel formula")).not.toBeInTheDocument();
    });
  });
});
