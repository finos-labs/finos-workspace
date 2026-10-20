import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { FormParamElement } from "~/components/DraggableCard/FormParamDef";
import type { ParamDefT, WidgetT } from "~/components/types";
import { useWidgetContext } from "~/components/Widget.context";
import { useJsonData } from "~/lib/api";
import { type Source, useBackendConnectorStore } from "~/lib/state/backendConnector";
import { partial } from "../../mocks";

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: vi.fn(),
}));

vi.mock("~/lib/api", () => ({
  useJsonData: vi.fn().mockReturnValue({
    data: ["option-a", "option-b"],
    isLoading: false,
    error: null,
    dataUpdatedAt: 0,
  }),
  convertHeadersToRecord: (
    headers: Record<string, string> = {},
    params: Record<string, string> = {},
  ) => ({ headers, newParams: params }),
  cleanSearchParams: (url: string, params: Record<string, string> = {}) =>
    Object.keys(params).length ? `${url}?${new URLSearchParams(params)}` : (url ?? ""),
}));

vi.mock("~/components/ds/molecules/Form", () => ({
  FormField: ({
    render: renderProp,
    name,
  }: {
    render: (props: { field: object }) => ReactNode;
    name?: string;
  }) => renderProp({ field: { value: "", onChange: vi.fn(), name } }),
}));

vi.mock("~/components/NewAdvancedSelect", () => ({
  AdvancedSelect: () => <div data-testid="advanced-select" />,
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const OPTIONS_ENDPOINT = "https://my-api.com/options/categories";
const CUSTOM_HEADERS = {
  "X-Api-Key": "secret-key",
  "X-Custom-Header": "custom-value",
};

// The data backend's credentials live on its source in page memory, never on the widget
const SOURCE = partial<Source>({
  id: "src-1",
  name: "My API",
  url: "https://my-api.com",
  endpointHeaders: Object.entries(CUSTOM_HEADERS).map(([key, value]) => ({
    key,
    value,
    location: "headers" as const,
  })),
});

const mockWidget = partial<WidgetT>({
  id: "test-widget",
  sourceId: "src-1",
  endpoint: { url: "https://my-api.com/data", method: "GET" },
  params: [
    {
      type: "form",
      paramName: "form_param",
      label: "My Form",
      endpoint: "https://my-api.com/submit",
      method: "POST",
      inputParams: [
        {
          type: "endpoint",
          paramName: "category",
          label: "Category",
          optionsEndpoint: OPTIONS_ENDPOINT,
        },
      ],
    },
  ],
});

/** Renders the form of the widget the mocked widget context holds */
const renderForm = () => {
  const { widget } = (useWidgetContext as Mock)() as { widget: WidgetT };
  const formParamDef = widget.params?.find(
    (param): param is ParamDefT<"form"> => param.type === "form",
  );
  return render(<FormParamElement formParamDef={formParamDef as ParamDefT<"form">} />);
};

const createMockWidgetContext = (widget: WidgetT = mockWidget) => ({
  widget,
  updateWidget: vi.fn(),
  widgetRef: { current: widget },
  activeDashboardId: "test-dashboard",
  isShared: false,
  uuid: "test-uuid",
  getWidget: () => widget,
});

describe("FormParamElement - EndpointType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useWidgetContext as Mock).mockReturnValue(createMockWidgetContext());
    useBackendConnectorStore.setState({ apiSources: [SOURCE] });
  });

  it("passes the source's headers as endpointHeaders to useJsonData when fetching options", () => {
    renderForm();

    expect(vi.mocked(useJsonData)).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointHeaders: CUSTOM_HEADERS,
        url: OPTIONS_ENDPOINT,
      }),
      expect.anything(),
    );
  });

  it("does not pass headers under the wrong key name", () => {
    renderForm();

    const callArgs = vi.mocked(useJsonData).mock.calls[0]?.[0];
    expect(callArgs).not.toHaveProperty("headers");
  });

  it("ignores headers saved on the widget itself", () => {
    const widgetWithHeaders = partial<WidgetT>({
      ...mockWidget,
      // Saved widgets carry no credentials; one that does is not trusted
      endpoint: {
        url: "https://my-api.com/data",
        method: "GET",
        headers: { "X-Api-Key": "stale-saved-key" },
      } as WidgetT["endpoint"],
    });
    (useWidgetContext as Mock).mockReturnValue(
      createMockWidgetContext(widgetWithHeaders),
    );

    renderForm();

    expect(vi.mocked(useJsonData)).toHaveBeenCalledWith(
      expect.objectContaining({ endpointHeaders: CUSTOM_HEADERS }),
      expect.anything(),
    );
  });

  it("still fetches options when the source has no headers", () => {
    useBackendConnectorStore.setState({
      apiSources: [{ ...SOURCE, endpointHeaders: [] }],
    });

    renderForm();

    expect(vi.mocked(useJsonData)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: OPTIONS_ENDPOINT,
        endpointHeaders: {},
      }),
      expect.anything(),
    );
  });
});

describe("FormParamElement - the source's query rows", () => {
  const QUERY_ROW = {
    key: "apikey",
    value: "query-secret",
    location: "query" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useBackendConnectorStore.setState({
      apiSources: [
        { ...SOURCE, endpointHeaders: [...(SOURCE.endpointHeaders ?? []), QUERY_ROW] },
      ],
    });
  });

  it("go with the options request as params, apart from the headers", () => {
    (useWidgetContext as Mock).mockReturnValue(createMockWidgetContext());

    renderForm();

    expect(vi.mocked(useJsonData)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${OPTIONS_ENDPOINT}?apikey=query-secret`,
        params: { apikey: "query-secret" },
        endpointHeaders: CUSTOM_HEADERS,
      }),
      expect.anything(),
    );
  });

  it("go with the form's submit, as do the headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: "Saved" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const widgetWithSubmit = partial<WidgetT>({
      ...mockWidget,
      params: [
        {
          type: "form",
          paramName: "form_param",
          label: "My Form",
          endpoint: "https://my-api.com/submit",
          method: "POST",
          inputParams: [
            { type: "button", paramName: "action", label: "Submit", value: "go" },
          ],
        },
      ],
    });
    (useWidgetContext as Mock).mockReturnValue(
      createMockWidgetContext(widgetWithSubmit),
    );

    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://my-api.com/submit?apikey=query-secret");
    expect(init.headers).toMatchObject(CUSTOM_HEADERS);
    vi.unstubAllGlobals();
  });
});
