import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminSidebar from "~/components/LayoutAdmin/AdminSidebar";
import { useIsEntityAdmin } from "~/hooks/useEntityAdmin";

vi.mock("~/hooks/useEntityAdmin", () => ({ useIsEntityAdmin: vi.fn() }));
vi.mock("~/hooks/useAdminMarketplace", () => ({
  useIsMarketplaceAdmin: () => ({ isMarketplaceAdmin: false, isLoading: false }),
}));
vi.mock("~/lib/runtimeConfig", () => ({
  getConfig: () => ({ ui: { showMarketplace: false } }),
}));
vi.mock("~/lib/state/sidebar", () => ({
  useShallowSidebarStore: () => vi.fn(),
}));
vi.mock("~/components/LayoutAuth/AppLayout/hooks/usePanelsState", () => ({
  useLayoutPanelsState: () => [{}, vi.fn()],
}));
vi.mock("~/components/LayoutAuth/HamburgerMenu", () => ({ default: () => null }));
vi.mock("~/components/General/Sidebar", () => ({
  default: ({ children }: { children: ReactNode }) => <nav>{children}</nav>,
}));
vi.mock("~/components/General/SidebarNavButton", () => ({
  default: ({ to, title }: { to: string; title: string }) => <a href={to}>{title}</a>,
}));

function signedInAs(isEntityAdmin: boolean) {
  vi.mocked(useIsEntityAdmin).mockReturnValue({ isEntityAdmin, isLoading: false });
}

describe("AdminSidebar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links to the entities for a superuser", () => {
    signedInAs(true);
    render(<AdminSidebar expandedState={{ left: true, collapsedLeft: false }} />);

    expect(screen.getByRole("link", { name: "Entities" })).toHaveAttribute(
      "href",
      "/admin/entities",
    );
  });

  it("does not show the entities to anyone else", () => {
    signedInAs(false);
    render(<AdminSidebar expandedState={{ left: true, collapsedLeft: false }} />);

    expect(screen.queryByRole("link", { name: "Entities" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
  });
});
