import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import PdfViewer from "~/components/Widgets/PdfViewer";

const cardProps = vi.hoisted(() => ({
  exportFns: undefined as { pdfFunction: (title: string) => void } | undefined,
}));

vi.mock("~/components/DraggableCard", () => ({
  default: ({
    children,
    loading,
    error,
    exportFns,
  }: {
    children?: ReactNode;
    loading?: boolean;
    error?: boolean;
    exportFns?: { pdfFunction: (title: string) => void };
  }) => {
    cardProps.exportFns = exportFns;
    return (
      <div data-testid="draggable-card" data-loading={loading} data-error={error}>
        {children}
      </div>
    );
  },
  SetLoadingOnResize: ({ children }: { children?: ReactNode }) => (
    <div data-testid="set-loading-on-resize">{children}</div>
  ),
}));

vi.mock("~/hooks/useStateReducer", () => ({
  useStateReducer: (initialState: object) => [initialState, vi.fn()],
}));

vi.mock("~/lib/api", () => ({
  useJsonData: () => ({
    data: { objectUrl: "http://example.com/test.pdf", aiData: {} },
    isLoading: false,
    isError: false,
    dataUpdatedAt: Date.now(),
  }),
}));

vi.mock("~/lib/state/copilot", () => ({
  useShallowCopilotStore: () => "chat-1",
}));

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: () => ({
    widget: {
      endpoint: { url: "http://example.com/test.pdf", method: "GET" },
      storage: { page: 1, scale: 1, params: {} },
      name: "Test PDF",
      connectionType: "file",
    },
    updateWidget: vi.fn(),
  }),
}));

vi.mock("~/components/WidgetParams/QueryParams", () => ({
  useWidgetParamsPositions: () => ({
    renderRow0Params: null,
    renderBelowNavbarRows: null,
  }),
}));

vi.mock("~/components/Widgets/Helpers/PdfViewerCore", () => ({
  PdfViewerCore: ({ file }: { file?: unknown }) => (
    <div data-testid="pdf-viewer-core" data-file={file}>
      PDF Viewer Core
    </div>
  ),
}));

describe("PdfViewer Widget", () => {
  it("renders PDF viewer container", () => {
    render(<PdfViewer />);

    expect(screen.getByTestId("draggable-card")).toBeInTheDocument();
  });

  it("renders PDF core component", () => {
    render(<PdfViewer />);

    expect(screen.getByTestId("pdf-viewer-core")).toBeInTheDocument();
  });

  it("passes file URL to PDF core", () => {
    render(<PdfViewer />);

    const pdfCore = screen.getByTestId("pdf-viewer-core");
    expect(pdfCore.getAttribute("data-file")).toBe("http://example.com/test.pdf");
  });

  it("wraps content in SetLoadingOnResize", () => {
    render(<PdfViewer />);

    expect(screen.getByTestId("set-loading-on-resize")).toBeInTheDocument();
  });

  it("passes loading state to DraggableCard", () => {
    render(<PdfViewer />);

    const card = screen.getByTestId("draggable-card");
    expect(card.getAttribute("data-loading")).toBe("false");
  });

  it("exports the PDF file itself, never a screenshot", () => {
    render(<PdfViewer />);

    expect(Object.keys(cardProps.exportFns ?? {})).toEqual(["pdfFunction"]);

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const create = vi.spyOn(document, "createElement");
    cardProps.exportFns?.pdfFunction("my-report");

    const link = create.mock.results
      .map((r) => r.value)
      .find((el) => el instanceof HTMLAnchorElement) as HTMLAnchorElement;
    expect(link.download).toBe("my-report.pdf");
    expect(link.href).toBe("http://example.com/test.pdf");
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
    create.mockRestore();
  });
});
