import * as TabsPrimitive from "@radix-ui/react-tabs";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DataConnectors from "~/routes/newDataConnectors";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("~/lib/contexts/MyDataConnectorsContext", () => ({
  MyDataConnectorsProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="my-data-connectors-provider">{children}</div>
  ),
}));

vi.mock("~/components/DataConnectors/MyWidgetsTab", () => ({
  MyWidgetsTab: () => <div data-testid="my-widgets-tab">My Widgets Tab</div>,
}));

vi.mock("~/components/LayoutAuth/Skeleton/SettingsLayout", () => ({
  SettingsLayout: ({
    children,
    title,
    tabs,
    defaultTab,
  }: {
    children: ReactNode;
    title: string;
    tabs: { id: string; label?: ReactNode; disabled?: boolean }[];
    defaultTab?: string;
  }) => (
    <TabsPrimitive.Root defaultValue={defaultTab || tabs[0]?.id}>
      <div data-testid="settings-layout">
        <h1>{title}</h1>
        <TabsPrimitive.List data-testid="tabs">
          {tabs.map((tab) => (
            <TabsPrimitive.Trigger key={tab.id} value={tab.id} data-tab-id={tab.id}>
              {tab.label}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
        {children}
      </div>
    </TabsPrimitive.Root>
  ),
}));

describe("DataConnectors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Widgets Library title", () => {
    render(
      <BrowserRouter>
        <DataConnectors />
      </BrowserRouter>,
    );

    expect(screen.getByText("Widgets Library")).toBeInTheDocument();
  });

  it("renders MyWidgetsTab", () => {
    render(
      <BrowserRouter>
        <DataConnectors />
      </BrowserRouter>,
    );

    expect(screen.getByTestId("my-widgets-tab")).toBeInTheDocument();
  });

  it("wraps content in MyDataConnectorsProvider", () => {
    render(
      <BrowserRouter>
        <DataConnectors />
      </BrowserRouter>,
    );

    expect(screen.getByTestId("my-data-connectors-provider")).toBeInTheDocument();
  });

  it("renders My Data tab", () => {
    render(
      <BrowserRouter>
        <DataConnectors />
      </BrowserRouter>,
    );

    expect(screen.getByText("My Data")).toBeInTheDocument();
  });
});
