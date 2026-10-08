import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

type DocumentProps = {
  children?: ReactNode;
  onLoadSuccess?: (document: { numPages: number }) => void;
};

const { documentMock } = vi.hoisted(() => ({
  documentMock: vi.fn(({ children }: DocumentProps) => (
    <div data-testid="pdf-document">{children}</div>
  )),
}));

vi.mock("react-pdf", () => ({
  Document: (props: DocumentProps) => documentMock(props),
  Page: () => <div data-testid="pdf-page" />,
  pdfjs: {
    GlobalWorkerOptions: {},
    version: "test",
  },
}));

vi.mock("react-pdf/dist/Page/AnnotationLayer.css", () => ({}));
vi.mock("react-pdf/dist/Page/TextLayer.css", () => ({}));

vi.mock("~/components/General/BrandedLogo", () => ({
  default: () => <div data-testid="branded-logo" />,
}));

vi.mock("~/components/Icon", () => ({
  default: ({ id }: { id: string }) => <span data-testid={`icon-${id}`} />,
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: () => ({
    updateWidget: vi.fn(),
  }),
}));

import { PdfViewerCore } from "~/components/Widgets/Helpers/PdfViewerCore";

describe("PdfViewerCore", () => {
  it("opens external PDF links in a new tab", () => {
    render(
      <PdfViewerCore
        file="blob:test-pdf"
        currentPage={1}
        currentScale={1}
        showPageNavigation={false}
        showZoomControls={false}
        showSearch={false}
      />,
    );

    expect(screen.getByTestId("pdf-document")).toBeInTheDocument();
    expect(documentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalLinkTarget: "_blank",
      }),
    );
  });

  const triggerLoad = (numPages: number) => {
    act(() => {
      const onLoadSuccess = documentMock.mock.calls.at(-1)?.[0]?.onLoadSuccess;
      onLoadSuccess?.({ numPages });
    });
  };

  it("preserves the current page when the document (re)loads", () => {
    const onPageChange = vi.fn();
    render(
      <PdfViewerCore
        file="blob:test-pdf"
        currentPage={5}
        currentScale={1}
        onPageChange={onPageChange}
        showPageNavigation={false}
        showZoomControls={false}
        showSearch={false}
      />,
    );

    triggerLoad(10);
    act(() => {
      expect(onPageChange).not.toHaveBeenCalled();
    });
  });

  it("clamps the current page when it exceeds the document length", () => {
    const onPageChange = vi.fn();
    render(
      <PdfViewerCore
        file="blob:test-pdf"
        currentPage={20}
        currentScale={1}
        onPageChange={onPageChange}
        showPageNavigation={false}
        showZoomControls={false}
        showSearch={false}
      />,
    );

    triggerLoad(10);
    act(() => {
      expect(onPageChange).toHaveBeenCalledWith(10);
    });
  });
});
