import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import {
  type CreateWidgetParams,
  useCreateWidgetFromArtifact,
} from "~/components/AI/hooks/useCreateWidgetFromArtifact";
import { useCopilotStore } from "~/lib/state/copilot";
import { required } from "../../../mocks";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  },
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "dashboard-123" }),
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams()],
}));

// Mock API
const mockCreateMetaDataWidget = vi.fn();
vi.mock("~/api/auth.api", () => ({
  createMetaDataWidget: (...args: unknown[]) => mockCreateMetaDataWidget(...args),
}));

// Mock app store
const mockAddWidget = vi.fn();
const mockAddTab = vi.fn();
const mockGetLastInnerTab = vi.fn().mockReturnValue("");
vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      addWidget: mockAddWidget,
      addTab: mockAddTab,
      getLastInnerTab: mockGetLastInnerTab,
    }),
}));

// Mock theme store
vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ aiEnhancements: true }),
}));

// Mock copilotData store
vi.mock("~/lib/state/copilotData", () => ({
  useShallowCopilotDataStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      copilotWidgets: { selectedWidgets: [] },
    }),
}));

// Mock fetch for AI widget info
global.fetch = vi.fn();

describe("useCreateWidgetFromArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The API mints the agent token the default Copilot is called with
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { token: "agent-token", expires_in: 1800 },
    });
    mockCreateMetaDataWidget.mockResolvedValue("new-widget-id");
    mockAddWidget.mockResolvedValue(undefined);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "AI Title", description: "AI Description" }),
    });
    useCopilotStore.setState({ createWidgetMetadataDialog: null });
  });

  describe("createWidget", () => {
    it("shows loading toast when creating widget", async () => {
      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        result.current.createWidget({
          widgetType: "html",
          content: "<p>data</p>",
          metadata: null,
        });
      });

      expect(toast.loading).toHaveBeenCalledWith(
        "Creating html widget...",
        expect.objectContaining({
          cancel: expect.objectContaining({
            label: "Edit metadata",
          }),
        }),
      );
    });

    it("shows success toast with Edit metadata button after creation", async () => {
      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidget({
          widgetType: "html",
          content: "<p>data</p>",
          metadata: null,
        });
      });

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            cancel: expect.objectContaining({
              label: "Edit metadata",
            }),
          }),
        );
      });
    });

    it("shows error toast when creation fails", async () => {
      mockAddWidget.mockRejectedValue(new Error("Failed to add widget"));

      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidget({
          widgetType: "html",
          content: "<p>data</p>",
          metadata: null,
        });
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to create widget",
          expect.objectContaining({
            description: "Failed to add widget",
          }),
        );
      });
    });

    it("uses fallback name when AI fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error"),
      );

      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidget({
          widgetType: "html",
          content: "<p>data</p>",
          metadata: null,
        });
      });

      await waitFor(() => {
        expect(mockAddWidget).toHaveBeenCalled();
      });
    });

    it("uses existing metadata name when provided", async () => {
      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidget({
          widgetType: "text",
          content: "Test content",
          metadata: {
            name: "Custom Name",
            description: "Custom Description",
          },
        });
      });

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalled();
      });
    });
  });

  describe("a text artifact", () => {
    it("is added as a markdown widget holding the text, without saving metadata", async () => {
      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidget({
          widgetType: "text",
          content: "# Title\n\nSome text. <citation>ref</citation>",
          metadata: null,
        });
      });

      expect(mockCreateMetaDataWidget).not.toHaveBeenCalled();
      expect(mockAddWidget).toHaveBeenCalledTimes(1);
      const [dashboardId, widget] = mockAddWidget.mock.calls[0];
      expect(dashboardId).toBe("dashboard-123");
      expect(widget).toEqual(
        expect.objectContaining({
          widgetId: "markdown",
          type: "custom",
          name: "AI Title",
          description: "AI Description",
          storage: { text: "# Title\n\nSome text" },
        }),
      );
      expect(widget.connectionType).toBeUndefined();
    });

    it("has no metadata to edit afterwards", async () => {
      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidget({
          widgetType: "text",
          content: "Test content",
          metadata: { name: "Summary", description: "A summary" },
        });
      });

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      const options = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(options.cancel).toBeUndefined();
    });

    it("has no metadata to edit when created with metadata from the dialog", async () => {
      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidgetWithMetadata(
          { widgetType: "text", content: "Test content" },
          { name: "Summary", description: "A summary" },
        );
      });

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      const options = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(options.cancel).toBeUndefined();
    });
  });

  describe("Edit metadata button on loading toast", () => {
    it("opens dialog when Edit metadata is clicked on loading toast", async () => {
      let cancelCallback: (() => void) | undefined;

      (toast.loading as ReturnType<typeof vi.fn>).mockImplementation(
        (_message, options) => {
          cancelCallback = options?.cancel?.onClick;
          return "toast-id";
        },
      );

      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      const params: CreateWidgetParams = {
        widgetType: "html",
        content: "<p>data</p>",
        metadata: null,
      };

      // Start widget creation but don't await - we want to click cancel during loading
      act(() => {
        result.current.createWidget(params);
      });

      // Simulate clicking Edit metadata
      if (cancelCallback) {
        act(() => {
          required(cancelCallback)();
        });
      }

      // Dialog should be opened in create mode
      await waitFor(() => {
        const dialogState = useCopilotStore.getState().createWidgetMetadataDialog;
        expect(dialogState).not.toBeNull();
        expect(dialogState?.mode).toBe("create");
        expect(dialogState?.pendingParams).toBeDefined();
      });

      // Toast should be dismissed
      expect(toast.dismiss).toHaveBeenCalledWith("toast-id");
    });
  });

  describe("Edit metadata button on success toast", () => {
    it("opens dialog when Edit metadata is clicked on success toast", async () => {
      mockAddWidget.mockImplementation(() => {
        return new Promise((resolve) => resolve("widget-uuid"));
      });
      let cancelCallback: (() => void) | undefined;

      (toast.success as ReturnType<typeof vi.fn>).mockImplementation(
        (_message, options) => {
          cancelCallback = options?.cancel?.onClick;
          return "toast-id";
        },
      );

      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidget({
          widgetType: "html",
          content: "<p>data</p>",
          metadata: null,
        });
      });

      // Simulate clicking Edit metadata on success toast
      if (cancelCallback) {
        act(() => {
          required(cancelCallback)();
        });
      }

      // Dialog should be opened in update mode
      await waitFor(() => {
        const dialogState = useCopilotStore.getState().createWidgetMetadataDialog;
        expect(dialogState).not.toBeNull();
        expect(dialogState?.mode).toBe("update");
        expect(dialogState?.widgetUuid).toBeDefined();
        expect(dialogState?.widgetId).toBeDefined();
      });
    });
  });

  describe("createWidgetWithMetadata", () => {
    it("creates widget with provided metadata and shows Edit metadata button", async () => {
      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidgetWithMetadata(
          {
            widgetType: "html",
            content: "<p>data</p>",
            metadata: null,
          },
          {
            name: "Manual Name",
            description: "Manual Description",
          },
        );
      });

      expect(mockAddWidget).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        "Created: Manual Name",
        expect.objectContaining({
          cancel: expect.objectContaining({
            label: "Edit metadata",
          }),
        }),
      );
    });

    it("opens dialog when Edit metadata is clicked on success toast", async () => {
      mockAddWidget.mockImplementation(() => {
        return new Promise((resolve) => resolve("widget-uuid"));
      });
      let cancelCallback: (() => void) | undefined;

      (toast.success as ReturnType<typeof vi.fn>).mockImplementation(
        (_message, options) => {
          cancelCallback = options?.cancel?.onClick;
          return "toast-id";
        },
      );

      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidgetWithMetadata(
          {
            widgetType: "html",
            content: "<p>data</p>",
            metadata: null,
          },
          {
            name: "Manual Name",
            description: "Manual Description",
          },
        );
      });

      // Simulate clicking Edit metadata on success toast
      if (cancelCallback) {
        act(() => {
          required(cancelCallback)();
        });
      }

      // Dialog should be opened in update mode
      await waitFor(() => {
        const dialogState = useCopilotStore.getState().createWidgetMetadataDialog;
        expect(dialogState).not.toBeNull();
        expect(dialogState?.mode).toBe("update");
        expect(dialogState?.initialValues.name).toBe("Manual Name");
        expect(dialogState?.initialValues.description).toBe("Manual Description");
      });
    });

    it("shows loading toast during creation", async () => {
      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      await act(async () => {
        await result.current.createWidgetWithMetadata(
          {
            widgetType: "html",
            content: "<p>data</p>",
            metadata: null,
          },
          { name: "Test", description: "Test" },
        );
      });

      expect(toast.loading).toHaveBeenCalledWith("Creating widget...");
    });

    it("shows error toast on failure", async () => {
      mockAddWidget.mockRejectedValue(new Error("Creation failed"));

      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      let thrownError: Error | null = null;
      await act(async () => {
        try {
          await result.current.createWidgetWithMetadata(
            {
              widgetType: "html",
              content: "<p>data</p>",
              metadata: null,
            },
            { name: "Test", description: "Test" },
          );
        } catch (error) {
          thrownError = error as Error;
        }
      });

      expect((thrownError as Error | null)?.message).toBe("Creation failed");
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to create widget",
        expect.objectContaining({
          description: "Creation failed",
        }),
      );
    });
  });

  describe("AbortController behavior", () => {
    it("does not show error toast when request is aborted", async () => {
      // Make fetch hang so we can abort it
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 100);
          }),
      );

      let cancelCallback: (() => void) | undefined;

      (toast.loading as ReturnType<typeof vi.fn>).mockImplementation(
        (_message, options) => {
          cancelCallback = options?.cancel?.onClick;
          return "toast-id";
        },
      );

      const { result } = renderHook(() => useCreateWidgetFromArtifact());

      // Start widget creation
      act(() => {
        result.current.createWidget({
          widgetType: "html",
          content: "<p>data</p>",
          metadata: null,
        });
      });

      // Abort immediately
      if (cancelCallback) {
        act(() => {
          required(cancelCallback)();
        });
      }

      // Wait a bit for any potential error handling
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Error toast should NOT be called because it was aborted
      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
