import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminThemeSettings from "~/routes/admin/themeSettings";
import { stubStoreState } from "../../mocks";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("~/lib/state/entityTheme", () => ({
  useShallowEntityThemeStore: vi.fn(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ updateThemeSettings: vi.fn() }),
  ),
}));

vi.mock("~/components/LayoutAuth/Skeleton/SettingsLayout", () => ({
  SettingsLayout: ({
    children,
    title,
    tabs,
  }: {
    children: ReactNode;
    title: string;
    tabs: { id: string; label?: ReactNode; disabled?: boolean }[];
  }) => (
    <div data-testid="settings-layout">
      <h1>{title}</h1>
      <div data-testid="tabs">
        {tabs.map((tab) => (
          <button key={tab.id} data-tab-id={tab.id}>
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  ),
}));

vi.mock("@radix-ui/react-tabs", () => ({
  Content: ({ children, value }: { children: ReactNode; value: string }) => (
    <div role="tabpanel" data-value={value}>
      {children}
    </div>
  ),
}));

vi.mock("~/components/ThemeSettings/GroupingSettings", () => ({
  GroupingSettings: () => (
    <div data-testid="grouping-settings">Grouping Settings Component</div>
  ),
}));

describe("AdminThemeSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Theme Settings title", () => {
    render(
      <BrowserRouter>
        <AdminThemeSettings />
      </BrowserRouter>,
    );

    expect(screen.getByText("Theme Settings")).toBeInTheDocument();
  });

  it("renders the Grouping tab", () => {
    render(
      <BrowserRouter>
        <AdminThemeSettings />
      </BrowserRouter>,
    );

    expect(screen.getByText("Grouping")).toBeInTheDocument();
  });

  it("renders the GroupingSettings component", () => {
    render(
      <BrowserRouter>
        <AdminThemeSettings />
      </BrowserRouter>,
    );

    expect(screen.getByTestId("grouping-settings")).toBeInTheDocument();
  });

  it("calls updateThemeSettings on mount", async () => {
    const { useShallowEntityThemeStore } = await import("~/lib/state/entityTheme");
    const updateThemeSettings = vi.fn();

    stubStoreState(useShallowEntityThemeStore, { updateThemeSettings });

    render(
      <BrowserRouter>
        <AdminThemeSettings />
      </BrowserRouter>,
    );

    expect(updateThemeSettings).toHaveBeenCalled();
  });
});
