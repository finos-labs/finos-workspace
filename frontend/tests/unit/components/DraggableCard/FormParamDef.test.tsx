import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { FormParamElement } from "~/components/DraggableCard/FormParamDef";
import type { WidgetT } from "~/components/types";
import { useWidgetContext } from "~/components/Widget.context";
import { useJsonData } from "~/lib/api";
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
const CUSTOM_HEADERS = {
  "X-Api-Key": "secret-key",
  "X-Custom-Header": "custom-value",
};

const mockWidget = partial<WidgetT>({
  id: "test-widget",
  endpoint: {
    url: "https://my-api.com/data",
    headers: CUSTOM_HEADERS,
  },
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
  });

  it("requests the options with the backend connection's credentials", () => {
    render(<FormParamElement />);

    expect(vi.mocked(useJsonData)).toHaveBeenCalledWith(
      {
        request: {
          ok: true,
          request: {
            url: OPTIONS_ENDPOINT,
            method: "GET",
            credentials: CUSTOM_HEADERS,
            paramHeaders: {},
          },
        },
      },
      expect.anything(),
    );
  });

  it("still fetches options when widget has no endpoint headers", () => {
    const widgetWithoutHeaders = partial<WidgetT>({
      ...mockWidget,
      endpoint: { url: "https://my-api.com/data", headers: {} },
    });
    (useWidgetContext as Mock).mockReturnValue(
      createMockWidgetContext(widgetWithoutHeaders),
    );

    render(<FormParamElement />);

    expect(vi.mocked(useJsonData)).toHaveBeenCalledWith(
      {
        request: expect.objectContaining({
          ok: true,
          request: expect.objectContaining({ url: OPTIONS_ENDPOINT, credentials: {} }),
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

    render(<FormParamElement />);

    const request = vi.mocked(useJsonData).mock.calls[0]?.[0].request;
    expect(request?.ok && request.request.method).toBe("POST");
    expect(request?.ok && JSON.parse(request.request.body ?? "")).toEqual({
      region: "eu",
      kind: "retail",
      active: true,
    });
  });
});
