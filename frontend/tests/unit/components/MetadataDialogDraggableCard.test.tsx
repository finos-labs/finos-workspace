import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { patchWidgetMetadata } from "~/api/auth.api";
import { MetadataDialog } from "~/components/MetadataDialogDraggableCard";
import type { WidgetT } from "~/components/types";
import { useWidgetContext } from "~/components/Widget.context";
import type { WidgetMetadataItem } from "~/lib/state/backendConnector";
import { malformed, partial } from "../mocks";

const mockProcessWidgetId = vi.fn();
const mockUpdateWidget = vi.fn();
const mockHandleWidgetMetadata = vi.fn();

let mockWidget: WidgetT;
let mockWidgetMetadataItem: WidgetMetadataItem | null = null;

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("~/components/ds/dialogs/BaseDialog", () => ({
  BaseDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

vi.mock("~/components/ds/dialogs/Dialog", () => ({
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("~/api/auth.api", () => ({
  getFileWidgets: vi.fn(),
  getWidgetMetadata: vi.fn().mockResolvedValue([]),
  patchWidgetMetadata: vi.fn().mockResolvedValue({ success: true }),
  postFileWidget: vi.fn(),
  postWidgetMetadata: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("~/lib/state/backendConnector", () => ({
  isMetadataType: vi.fn().mockReturnValue(false),
  useShallowBackendConnectorStore: (
    selector: (state: {
      setStoredFiles: () => void;
      setWidgetMetadata: () => void;
      getWidgetMetadataById: () => WidgetMetadataItem | null;
    }) => unknown,
  ) =>
    selector({
      setStoredFiles: vi.fn(),
      setWidgetMetadata: vi.fn(),
      getWidgetMetadataById: () => mockWidgetMetadataItem,
    }),
}));

vi.mock("~/lib/state/copilotData", () => ({
  useShallowCopilotDataStore: (
    selector: (state: {
      addDataOnDashboardWidget: () => void;
      dashboardWidgetsData: Record<string, unknown>;
    }) => unknown,
  ) =>
    selector({
      addDataOnDashboardWidget: vi.fn(),
      dashboardWidgetsData: {},
    }),
}));

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: (
    selector: (state: {
      getWidgetsByAttribute: () => Record<string, WidgetT[]>;
      updateWidget: () => void;
    }) => unknown,
  ) =>
    selector({
      getWidgetsByAttribute: () => ({}),
      updateWidget: vi.fn(),
    }),
}));

vi.mock("~/utils/dataConnectorsHelpers", () => ({
  handleWidgetMetadata: (...args: unknown[]) => mockHandleWidgetMetadata(...args),
}));

vi.mock("~/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/utils")>();
  return {
    ...actual,
    dispatchSaveState: vi.fn(),
    dispatchUpdateWidget: vi.fn(),
    processWidgetId: (...args: unknown[]) => mockProcessWidgetId(...args),
  };
});

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: vi.fn(),
}));

const useWidgetContextMock = vi.mocked(useWidgetContext);

const setOpen = vi.fn();

function makeWidget(overrides: Partial<WidgetT> = {}): WidgetT {
  return {
    id: "widget-local-id",
    uuid: "widget-local-id",
    name: "Widget Name",
    description: "Widget Description",
    category: "Initial Category",
    subCategory: "Initial Sub Category",
    source: malformed("Initial Source"),
    widgetId: "html-6630acf6-dcb1-4611-9430-5ac2e5b9bd22",
    type: "html",
    storage: {},
    params: [],
    ...overrides,
  } as WidgetT;
}

function setupContext(widget: WidgetT) {
  useWidgetContextMock.mockReturnValue(
    partial({
      widget,
      activeDashboardId: "dashboard-1",
      updateWidget: mockUpdateWidget,
    }),
  );
}

describe("MetadataDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWidgetMetadataItem = {
      widgetId: "6630acf6-dcb1-4611-9430-5ac2e5b9bd22",
      name: "Stored Name",
      description: "Stored Description",
      category: "Stored Category",
      subCategory: "Stored Sub Category",
      source: "Stored Source",
      storage: {},
      widgetType: "iframe",
    };
    mockWidget = makeWidget();
    setupContext(mockWidget);
    mockHandleWidgetMetadata.mockReturnValue(mockWidgetMetadataItem);
    mockProcessWidgetId.mockReturnValue({
      uuid: "6630acf6-dcb1-4611-9430-5ac2e5b9bd22",
      cleanWidgetId: "html",
    });
  });

  it("prefills the form from the stored widget metadata", async () => {
    render(<MetadataDialog open={true} setOpen={setOpen} />);

    expect(await screen.findByLabelText("Name")).toHaveValue("Stored Name");
    expect(screen.getByLabelText(/Description/i)).toHaveValue("Stored Description");
    expect(screen.getByLabelText(/^Category\b/i)).toHaveValue("Stored Category");
  });

  it("patches the existing widget metadata with the edited form values", async () => {
    const user = userEvent.setup();
    render(<MetadataDialog open={true} setOpen={setOpen} />);

    const nameInput = await screen.findByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Quarterly Report");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchWidgetMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Quarterly Report",
          description: "Stored Description",
        }),
        "6630acf6-dcb1-4611-9430-5ac2e5b9bd22",
      ),
    );
    expect(setOpen).toHaveBeenCalledWith(false);
  });
});
