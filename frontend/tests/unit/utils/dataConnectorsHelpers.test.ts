import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetT } from "~/components/types";
import { handleWidgetMetadata } from "~/utils/dataConnectorsHelpers";

const mockGetStoredFileById = vi.fn();
const mockGetWidgetMetadataById = vi.fn();

vi.mock("~/lib/state/backendConnector", () => ({
  useBackendConnectorStore: {
    getState: () => ({
      getStoredFileById: mockGetStoredFileById,
      getWidgetMetadataById: mockGetWidgetMetadataById,
    }),
  },
}));

vi.mock("~/lib/utils", () => ({
  processWidgetId: vi.fn((widgetId: string, connectionType: string) => ({
    uuid: widgetId.split("-")[0] || "default-uuid",
    connectionType,
  })),
}));

describe("handleWidgetMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the stored file by id for the file connection type", () => {
    const mockFile = { id: "file-1", name: "File" };
    mockGetStoredFileById.mockReturnValue(mockFile);

    const widget = {
      widgetId: "uuid-456",
      connectionType: "file",
    } as unknown as WidgetT;

    expect(handleWidgetMetadata(widget)).toEqual(mockFile);
    expect(mockGetStoredFileById).toHaveBeenCalledWith("uuid");
    expect(mockGetWidgetMetadataById).not.toHaveBeenCalled();
  });

  it("returns the widget metadata by id for other connection types", () => {
    const mockMetadata = { id: "meta-1", name: "Note" };
    mockGetWidgetMetadataById.mockReturnValue(mockMetadata);

    const widget = {
      widgetId: "meta-123",
      connectionType: "widgetMetadata",
    } as unknown as WidgetT;

    expect(handleWidgetMetadata(widget)).toEqual(mockMetadata);
    expect(mockGetWidgetMetadataById).toHaveBeenCalledWith("meta");
    expect(mockGetStoredFileById).not.toHaveBeenCalled();
  });
});
