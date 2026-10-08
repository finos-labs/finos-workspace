import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Sidebar from "~/components/General/Sidebar";

vi.mock("~/components/General/ChangelogDialog", () => ({
  default: () => null,
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="tooltip">{children}</div>
  ),
}));

vi.mock("~/components/ds/dialogs/BaseDialog", () => ({
  BaseDialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div data-testid="base-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const renderSidebar = (props = {}) => {
  return render(
    <BrowserRouter>
      <Sidebar {...props}>
        <div data-testid="sidebar-children">Sidebar content</div>
      </Sidebar>
    </BrowserRouter>,
  );
};

describe("Sidebar", () => {
  it("renders basic sidebar structure", () => {
    renderSidebar();

    expect(screen.getByTestId("sidebar-children")).toBeInTheDocument();
  });

  it("renders header when provided", () => {
    renderSidebar({
      header: <div data-testid="custom-header">Custom Header</div>,
    });

    expect(screen.getByTestId("custom-header")).toBeInTheDocument();
  });

  it("renders search when provided", () => {
    renderSidebar({
      search: <input data-testid="search-input" placeholder="Search" />,
    });

    expect(screen.getByTestId("search-input")).toBeInTheDocument();
  });

  it("renders children content", () => {
    renderSidebar();

    expect(screen.getByText("Sidebar content")).toBeInTheDocument();
  });
});
