import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParamDef, WidgetT } from "~/components/types";
import type { Group } from "~/lib/state/app";
import type { DeepPartial } from "../../mocks";

const mocks = vi.hoisted(() => ({
  widget: null as DeepPartial<WidgetT> | null,
  appGroups: [] as DeepPartial<Group>[],
  updateWidget: vi.fn(),
  activeDashboardId: "dashboard-1",
  isShared: false,
  sharedGroups: [] as DeepPartial<Group>[],
  updateGroup: vi.fn(),
  useQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueries: mocks.useQueries,
}));

vi.mock("~/components/NewAdvancedSelect", async () => {
  const React = await import("react");

  return {
    AdvancedSelect: ({
      label,
      selected,
      values,
      onSelect,
    }: {
      label?: string;
      selected?: string;
      values: { label: string; value: string }[];
      onSelect: (value: string | undefined) => void;
    }) => {
      const selectedOption = values.find((value) => value.value === selected);
      const nextOption = values.find((value) => value.value !== selected) ?? values[0];

      return React.createElement(
        "button",
        { type: "button", onClick: () => onSelect(nextOption?.value) },
        selectedOption?.label ?? label,
      );
    },
  };
});

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: () => ({
    widget: mocks.widget,
    widgetFromJSON: mocks.widget,
    activeDashboardId: mocks.activeDashboardId,
    isShared: mocks.isShared,
    updateWidget: mocks.updateWidget,
  }),
}));

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getWidgetGroups: () => mocks.appGroups,
      getTabById: () => undefined,
      updateGroup: mocks.updateGroup,
    }),
}));

vi.mock("~/lib/state/sharedApp", () => ({
  useShallowSharedAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getWidgetGroups: () => mocks.sharedGroups,
      getDashboardById: () => undefined,
    }),
}));

vi.mock("~/components/Widgets/Helpers/GroupDropdown", async () => {
  const { createContext } = await import("react");

  return {
    GroupDropdownAnchorContext: createContext(null),
    default: ({
      children,
      paramDef,
    }: {
      children?: ReactNode;
      paramDef?: ParamDef;
    }) => (
      <div data-testid="group-dropdown" data-param-name={paramDef?.paramName}>
        {children ?? paramDef?.label ?? paramDef?.paramName}
      </div>
    ),
  };
});

vi.doUnmock("~/components/WidgetParams/QueryParams");

const { RenderParamsForRow } = await import("~/components/WidgetParams/QueryParams");
const { useWidgetParamsPositions } = await import(
  "~/components/WidgetParams/QueryParams"
);

function makeEndpointWidget(selection: string): DeepPartial<WidgetT> {
  const selectionParam: DeepPartial<ParamDef> = {
    paramName: "selection",
    type: "endpoint",
    groupById: "selection-options",
    label: "Category / Tag / Event",
    optionsEndpoint: "/options/selection-options",
    value: "All",
    show: true,
    optionsParams: {
      field: "selection",
      selection: "$selection",
    },
  };

  return {
    id: "widget-1",
    widgetId: "volume_by_category",
    external: true,
    data: {},
    storage: {
      params: {
        selection,
      },
    },
    params: [selectionParam],
  };
}

function ParamsHarness() {
  const { renderRow0Params } = useWidgetParamsPositions();
  return <div>{renderRow0Params}</div>;
}

beforeEach(() => {
  mocks.widget = null;
  mocks.updateWidget = vi.fn();
  mocks.activeDashboardId = "dashboard-1";
  mocks.isShared = false;
  mocks.appGroups = [];
  mocks.sharedGroups = [];
  mocks.updateGroup.mockReset();
  mocks.useQueries.mockReset();
});

describe("RenderParamsForRow", () => {
  it("syncs rendered params when widget storage changes externally", async () => {
    mocks.useQueries.mockImplementation(({ queries }) =>
      queries.map(() => ({
        isLoading: false,
        isFetching: false,
        isError: false,
        data: [
          { label: "All categories", value: "All" },
          { label: "Crypto", value: "Crypto" },
        ],
        refetch: vi.fn(),
      })),
    );
    mocks.widget = makeEndpointWidget("All");

    const { rerender } = render(<ParamsHarness />);
    expect(screen.getByText("All categories")).toBeInTheDocument();

    mocks.widget = makeEndpointWidget("Crypto");
    rerender(<ParamsHarness />);

    await waitFor(() => {
      expect(screen.getByText("Crypto")).toBeInTheDocument();
    });
  });

  it("publishes visible grouped endpoint param changes to the group store", async () => {
    const user = userEvent.setup();
    mocks.useQueries.mockImplementation(({ queries }) =>
      queries.map(() => ({
        isLoading: false,
        isFetching: false,
        isError: false,
        data: [
          { label: "All categories", value: "All" },
          { label: "Sports", value: "Sports" },
        ],
        refetch: vi.fn(),
      })),
    );
    mocks.widget = makeEndpointWidget("All");
    mocks.appGroups = [
      {
        id: "group-1",
        type: "endpointParam",
        groupById: "selection-options",
        value: "All",
      },
    ];

    render(<ParamsHarness />);

    await user.click(screen.getByText("All categories"));

    await waitFor(() => {
      expect(mocks.updateGroup).toHaveBeenCalledWith(
        "dashboard-1",
        "group-1",
        expect.objectContaining({ value: "Sports" }),
      );
    });
    expect(mocks.updateWidget).not.toHaveBeenCalled();
  });

  it("gives a dependent endpoint param a value the new provider offers, before the widget loads", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [{ label: "Top stories", value: "bbc_top" }],
      })),
    );
    mocks.useQueries.mockImplementation(({ queries }) =>
      queries.map((query: { queryKey: unknown[] }) => ({
        isLoading: false,
        isFetching: false,
        isError: false,
        data: String(query.queryKey[0]).includes("rss_providers")
          ? [
              { label: "Wire", value: "wire" },
              { label: "BBC", value: "bbc" },
            ]
          : [{ label: "General News", value: "wire_general" }],
        refetch: vi.fn(),
      })),
    );
    const endpointParam = (
      paramName: string,
      extra: { optionsEndpoint: string; optionsParams?: Record<string, string> },
    ): DeepPartial<ParamDef> => ({
      paramName,
      type: "endpoint",
      groupById: `${paramName}-options`,
      label: paramName,
      show: true,
      ...extra,
    });
    mocks.widget = {
      id: "news-1",
      widgetId: "news_rss",
      external: true,
      data: {},
      endpoint: { url: "http://backend.test/api/v1/news/rss" },
      storage: { params: { outlet: "wire", source: "wire_general" } },
      params: [
        endpointParam("outlet", {
          optionsEndpoint: "http://backend.test/api/v1/news/rss_providers",
        }),
        endpointParam("source", {
          optionsEndpoint: "http://backend.test/api/v1/news/rss_feeds",
          optionsParams: { outlet: "$outlet" },
        }),
      ],
    };

    render(<ParamsHarness />);
    await user.click(screen.getByText("Wire"));

    // One update, with the provider and the feed it needs, so the widget loads once
    await waitFor(() => expect(mocks.updateWidget).toHaveBeenCalledTimes(1));
    const update = mocks.updateWidget.mock.calls[0][0];
    expect(update(mocks.widget).storage.params).toEqual({ outlet: "bbc", source: "" });
    vi.unstubAllGlobals();
  });

  describe("a dependent endpoint param saved with another provider", () => {
    const endpointParam = (
      paramName: string,
      extra: { optionsEndpoint: string; optionsParams?: Record<string, string> },
    ): DeepPartial<ParamDef> => ({
      paramName,
      type: "endpoint",
      groupById: `${paramName}-options`,
      label: paramName,
      show: true,
      ...extra,
    });

    const newsWidget = (
      params: Record<string, string>,
      extra: DeepPartial<WidgetT> = {},
    ): DeepPartial<WidgetT> => ({
      id: "news-1",
      widgetId: "news_rss",
      external: true,
      data: {},
      endpoint: { url: "http://backend.test/api/v1/news/rss" },
      storage: { params },
      params: [
        endpointParam("outlet", {
          optionsEndpoint: "http://backend.test/api/v1/news/rss_providers",
        }),
        endpointParam("source", {
          optionsEndpoint: "http://backend.test/api/v1/news/rss_feeds",
          optionsParams: { outlet: "$outlet" },
        }),
      ],
      ...extra,
    });

    const optionsOf =
      (feeds: object[]) =>
      ({ queries }: { queries: { queryKey: unknown[] }[] }) =>
        queries.map((query) => ({
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: true,
          data: String(query.queryKey[0]).includes("rss_providers")
            ? [
                { label: "Wire", value: "wire" },
                { label: "BBC", value: "bbc" },
              ]
            : feeds,
          refetch: vi.fn(),
        }));

    it("takes a value the options offer, so the widget does not load nothing", async () => {
      mocks.useQueries.mockImplementation(
        optionsOf([{ label: "Top stories", value: "bbc_top" }]),
      );
      mocks.widget = newsWidget({ outlet: "bbc", source: "wire_general" });

      render(<ParamsHarness />);

      await waitFor(() => expect(mocks.updateWidget).toHaveBeenCalledTimes(1));
      const update = mocks.updateWidget.mock.calls[0][0];
      expect(update(mocks.widget).storage.params).toEqual({
        outlet: "bbc",
        source: "",
      });
    });

    it("prefers the option the backend marks as selected", async () => {
      mocks.useQueries.mockImplementation(
        optionsOf([
          { label: "Top stories", value: "bbc_top" },
          { label: "World", value: "bbc_world", selected: true },
        ]),
      );
      mocks.widget = newsWidget({ outlet: "bbc", source: "wire_general" });

      render(<ParamsHarness />);

      await waitFor(() => expect(mocks.updateWidget).toHaveBeenCalledTimes(1));
      const update = mocks.updateWidget.mock.calls[0][0];
      expect(update(mocks.widget).storage.params.source).toBe("bbc_world");
    });

    it("leaves a value that the options offer", async () => {
      mocks.useQueries.mockImplementation(
        optionsOf([{ label: "Top stories", value: "bbc_top" }]),
      );
      mocks.widget = newsWidget({ outlet: "bbc", source: "bbc_top" });

      render(<ParamsHarness />);

      await waitFor(() => screen.getByText("Top stories"));
      expect(mocks.updateWidget).not.toHaveBeenCalled();
    });

    it("leaves an empty value and options that failed to load", async () => {
      mocks.useQueries.mockImplementation(optionsOf([]));
      mocks.widget = newsWidget({ outlet: "bbc", source: "wire_general" });

      render(<ParamsHarness />);

      await waitFor(() => screen.getByText("BBC"));
      expect(mocks.updateWidget).not.toHaveBeenCalled();
    });

    it("leaves a param that is in a group to its group", async () => {
      mocks.useQueries.mockImplementation(
        optionsOf([{ label: "Top stories", value: "bbc_top" }]),
      );
      mocks.widget = newsWidget(
        { outlet: "bbc", source: "wire_general" },
        { paramGroups: { "source-options": "group-1" } },
      );

      render(<ParamsHarness />);

      await waitFor(() => screen.getByText("BBC"));
      expect(mocks.updateWidget).not.toHaveBeenCalled();
    });
  });

  it("wraps boolean params with GroupDropdown so grouping affordances render", () => {
    const booleanParam = {
      paramName: "include_history",
      label: "Include History",
      type: "boolean",
      row: 0,
      options: [
        { label: "On", value: true },
        { label: "Off", value: false },
      ],
    } as ParamDef;

    render(
      <RenderParamsForRow
        rowParams={[booleanParam]}
        state={{ localParams: { include_history: "true" } }}
        updateParams={vi.fn()}
        endpointOptions={{}}
        endpointParams={{}}
        invalidResponseRef={{ current: {} }}
      />,
    );

    expect(screen.getByTestId("group-dropdown")).toBeInTheDocument();
    expect(screen.getByText("Include History")).toBeInTheDocument();
  });

  it("renders hidden row params as group badges instead of full controls", () => {
    const hiddenMarketParam = {
      paramName: "market_key",
      label: "Market",
      type: "endpoint",
      row: 1,
      show: false,
      groupById: "market_key-options",
    } as ParamDef;

    render(
      <RenderParamsForRow
        rowParams={[hiddenMarketParam]}
        state={{ localParams: { market_key: "KXMARKET" } }}
        updateParams={vi.fn()}
        endpointOptions={{}}
        endpointParams={{}}
        invalidResponseRef={{ current: {} }}
      />,
    );

    expect(screen.getByTestId("group-dropdown")).toHaveAttribute(
      "data-param-name",
      "market_key",
    );
    expect(screen.getByText("Market")).toBeInTheDocument();
  });
});

describe("forms", () => {
  function makeFormsWidget(): DeepPartial<WidgetT> {
    const form = (paramName: string, label: string | undefined, input: string) => ({
      paramName,
      type: "form" as const,
      label,
      endpoint: `https://backend.test/${paramName}`,
      inputParams: [{ paramName: input, type: "text" as const, label: input }],
    });
    return {
      id: "widget-1",
      widgetId: "notes",
      external: true,
      data: {},
      storage: { params: {} },
      params: [
        form("note", "Add note", "Text"),
        form("flag", "Flag a row", "Reason"),
        form("archive", undefined, "Until"),
      ],
    };
  }

  it("opens each of a widget's forms from a button named by the form's label", async () => {
    mocks.useQueries.mockImplementation(({ queries }) =>
      queries.map(() => ({ data: [] })),
    );
    mocks.widget = makeFormsWidget();

    render(<ParamsHarness />);

    expect(screen.getByRole("button", { name: "Add note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flag a row" })).toBeInTheDocument();
    // A form with no label is named by its paramName
    expect(screen.getByRole("button", { name: "archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Form" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Flag a row" }));

    expect(await screen.findByText("Reason")).toBeInTheDocument();
    expect(screen.queryByText("Text")).toBeNull();
  });
});
