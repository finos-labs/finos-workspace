// Tests the dashboard dialog: one field per registry setting, URL validation, and the
// widget URL it saves.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddPluginToDashboardDialog } from "~/components/Plugins/AddPluginToDashboardDialog";
import type { PluginMetadata, PluginSettingValues } from "~/lib/plugins";

const DASHBOARD_ID = "dashboard-1";

const app = vi.hoisted(() => ({
  addWidgets: vi.fn(async () => "widget-id"),
  addTab: vi.fn(),
}));

vi.mock("~/lib/state/app", () => {
  const state = {
    items: [],
    getRootTabs: () => [{ index: "dashboard-1", data: { name: "My dashboard" } }],
    addTab: app.addTab,
    addWidgets: app.addWidgets,
  };
  return {
    useShallowAppStore: (selector: (s: typeof state) => unknown) => selector(state),
  };
});

vi.mock("~/lib/state/sidebar", () => ({
  useSidebarStore: { getState: () => ({ activeItem: "dashboard-1" }) },
}));

vi.mock("~/lib/utils/widgetHighlight", () => ({
  scrollToAndHighlightWidget: vi.fn(),
}));

const plugin: PluginMetadata = {
  id: "bq-advanced-grouping",
  name: "BQ Advanced Grouping",
  description: "Advanced grouping and aggregation capabilities for data grids.",
  version: "1.0.0",
  category: "Data Grid",
  route: "/plugins/advanced-grouping",
  status: "active",
  settings: [
    {
      key: "dataSource",
      label: "Data source",
      type: "select",
      description: "Where this widget loads company data from.",
      options: [
        { value: "mock", label: "Sample data" },
        { value: "api", label: "API" },
      ],
    },
    { key: "apiUrl", label: "API URL", type: "url", description: "The companies API." },
  ],
};

function renderDialog(target: PluginMetadata = plugin) {
  const resolveUrl = vi.fn((settings: PluginSettingValues) => {
    const url = new URL(`http://localhost:5173${target.route}`);
    for (const [key, value] of Object.entries(settings))
      url.searchParams.set(key, value);
    return url.toString();
  });
  render(
    <MemoryRouter>
      <AddPluginToDashboardDialog
        plugin={target}
        resolveUrl={resolveUrl}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
  return { resolveUrl };
}

describe("AddPluginToDashboardDialog", () => {
  beforeEach(() => {
    app.addWidgets.mockClear();
  });

  it("renders a field for each declared setting", () => {
    renderDialog();
    expect(screen.getByText("Data source")).toBeInTheDocument();
    // The select shows "Plugin default" until a value is chosen.
    expect(screen.getAllByText("Plugin default").length).toBeGreaterThan(0);
    expect(screen.getByText("API URL")).toBeInTheDocument();
    expect(
      screen.getByText("Where this widget loads company data from."),
    ).toBeInTheDocument();
  });

  it("adds the widget with the entered settings in its URL", async () => {
    const { resolveUrl } = renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://"),
      "https://api.example.com/companies",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    // "Plugin default" is not passed, so the plugin keeps its own default.
    expect(resolveUrl).toHaveBeenCalledWith({
      apiUrl: "https://api.example.com/companies",
    });
    expect(app.addWidgets).toHaveBeenCalledWith(DASHBOARD_ID, [
      expect.objectContaining({
        storage: {
          html: "http://localhost:5173/plugins/advanced-grouping?apiUrl=https%3A%2F%2Fapi.example.com%2Fcompanies",
        },
      }),
    ]);
  });

  it("refuses a URL setting that is not http(s)", async () => {
    renderDialog();
    await userEvent.type(
      screen.getByPlaceholderText("https://"),
      "javascript:alert(1)",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Enter an http(s) URL")).toBeInTheDocument();
    expect(app.addWidgets).not.toHaveBeenCalled();
  });

  it("works for plugins without settings", async () => {
    const { resolveUrl } = renderDialog({ ...plugin, settings: undefined });
    expect(screen.queryByText("Data source")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(resolveUrl).toHaveBeenCalledWith({});
    expect(app.addWidgets).toHaveBeenCalledTimes(1);
  });
});
