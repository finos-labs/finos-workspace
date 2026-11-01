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

vi.mock("~/components/ds/atoms/Input", () => ({
  FormInput: () => <input />,
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
const HEADER_NAMES = ["X-Api-Key", "X-Custom-Header"];

const SOURCE = partial<Source>({
  id: "src-1",
  name: "My API",
  url: "https://my-api.com",
  endpointHeaders: HEADER_NAMES.map((key) => ({
    key,
    value: "",
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

  it("requests the options through the widget's source, with no credentials", () => {
    renderForm();

    expect(vi.mocked(useJsonData)).toHaveBeenCalledWith(
      {
        request: {
          ok: true,
          request: {
            url: OPTIONS_ENDPOINT,
            method: "GET",
            sourceId: "src-1",
            paramHeaders: {},
          },
        },
      },
      expect.anything(),
    );
  });

  it("does not pass headers under the wrong key name", () => {
    renderForm();

    const callArgs = vi.mocked(useJsonData).mock.calls[0]?.[0];
    expect(callArgs).not.toHaveProperty("headers");
  });

  it("never sends headers saved on the widget itself", () => {
    const widgetWithHeaders = partial<WidgetT>({
      ...mockWidget,
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

    const request = vi.mocked(useJsonData).mock.calls[0]?.[0].request;
    expect(request?.ok && request.request.sourceId).toBe("src-1");
    expect(JSON.stringify(request)).not.toContain("stale-saved-key");
  });

  it("still fetches options when the source has no headers", () => {
    useBackendConnectorStore.setState({
      apiSources: [{ ...SOURCE, endpointHeaders: [] }],
    });

    renderForm();

    expect(vi.mocked(useJsonData)).toHaveBeenCalledWith(
      {
        request: expect.objectContaining({
          ok: true,
          request: expect.objectContaining({
            url: OPTIONS_ENDPOINT,
            sourceId: "src-1",
          }),
        }),
      },
      expect.anything(),
    );
  });

  it("posts optionsParams as JSON, taking `$name` from another input or the widget", () => {
    const widget = partial<WidgetT>({
      ...mockWidget,
      params: [
        { type: "text", paramName: "region", value: "eu" },
        {
          type: "form",
          paramName: "form_param",
          endpoint: "https://my-api.com/submit",
          method: "POST",
          inputParams: [
            { type: "text", paramName: "kind", value: "retail" },
            {
              type: "endpoint",
              paramName: "category",
              optionsEndpoint: OPTIONS_ENDPOINT,
              optionsMethod: "POST",
              optionsParams: { region: "$region", kind: "$kind", active: true },
            },
          ],
        },
      ],
    });
    (useWidgetContext as Mock).mockReturnValue(createMockWidgetContext(widget));

    renderForm();

    const request = vi.mocked(useJsonData).mock.calls[0]?.[0].request;
    expect(request?.ok && request.request.method).toBe("POST");
    expect(request?.ok && JSON.parse(request.request.body ?? "")).toEqual({
      region: "eu",
      kind: "retail",
      active: true,
    });
  });
});

describe("FormParamElement - the source's query rows", () => {
  const QUERY_ROW = { key: "apikey", value: "", location: "query" as const };

  beforeEach(() => {
    vi.clearAllMocks();
    useBackendConnectorStore.setState({
      apiSources: [
        { ...SOURCE, endpointHeaders: [...(SOURCE.endpointHeaders ?? []), QUERY_ROW] },
      ],
    });
  });

  it("stay out of the options request's query", () => {
    (useWidgetContext as Mock).mockReturnValue(createMockWidgetContext());

    renderForm();

    expect(vi.mocked(useJsonData)).toHaveBeenCalledWith(
      {
        request: expect.objectContaining({
          ok: true,
          request: expect.objectContaining({
            url: OPTIONS_ENDPOINT,
            sourceId: "src-1",
          }),
        }),
      },
      expect.anything(),
    );
  });

  it("stay out of the form's submit, which goes through the API", async () => {
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
    expect(url).toMatch(/\/app\/data-connectors\/api-source\/src-1\/request$/);
    expect(JSON.parse(init.body)).toMatchObject({
      url: "https://my-api.com/submit",
      method: "POST",
    });
    expect(init.body).not.toContain("apikey");
    vi.unstubAllGlobals();
  });
});
