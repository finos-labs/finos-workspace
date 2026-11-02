import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MoveToTabsDropdownMenu from "~/components/MoveToDropDown/MoveToTabsMenu";

const targets = vi.hoisted(() => [
  { index: "plain", data: { name: "Plain Dashboard" }, children: [] },
  { index: "locked", data: { name: "Locked Dashboard", locked: true }, children: [] },
]);

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: () => ({
    widget: { id: "widget-1", innerTab: "" },
    activeDashboardId: "current",
    isShared: false,
  }),
}));

vi.mock("~/lib/state/app", () => ({
  useAppStore: { getState: () => ({ addTab: vi.fn(), duplicateWidget: vi.fn() }) },
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ getMoveToTabs: () => targets, getTabById: () => undefined }),
}));

vi.mock("~/components/Icon", () => ({ default: () => <span /> }));

describe("MoveToTabsDropdownMenu", () => {
  it("only offers to copy a widget to the dashboards that accept new widgets", async () => {
    render(
      <DropdownMenu.Root open>
        <DropdownMenu.Trigger />
        <DropdownMenu.Content>
          <MoveToTabsDropdownMenu />
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    );

    await userEvent.setup().click(screen.getByText("Copy to"));

    expect(
      screen.getByRole("menuitem", { name: "Plain Dashboard" }),
    ).not.toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: "Locked Dashboard" })).toHaveAttribute(
      "data-disabled",
    );
  });
});
