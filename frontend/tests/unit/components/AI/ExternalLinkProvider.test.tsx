import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExternalLinkAnchorProps } from "~/components/AI/ExternalLinkContext";
import { ExternalLinkProvider } from "~/components/AI/ExternalLinkProvider";

const h = vi.hoisted(() => ({
  addWidget: vi.fn(),
  dashboardId: { current: "dash-1" },
}));

vi.mock("~/components/AI/hooks/useActiveWorkspaceDashboardId", () => ({
  useActiveWorkspaceDashboardId: () => h.dashboardId.current,
}));

vi.mock("~/lib/state/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/state/app")>();
  return {
    ...actual,
    useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ addWidget: h.addWidget }),
  };
});

const URL = "https://example.com/report";

function TestLink({ href = URL }: { href?: string }) {
  const anchorProps = useExternalLinkAnchorProps(href);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...anchorProps}>
      open report
    </a>
  );
}

const renderWithProvider = (children: ReactNode = <TestLink />) =>
  render(<ExternalLinkProvider>{children}</ExternalLinkProvider>);

describe("ExternalLinkProvider", () => {
  beforeEach(() => {
    h.addWidget.mockClear();
    h.dashboardId.current = "dash-1";
    vi.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the external-link dialog on a plain left-click", () => {
    renderWithProvider();

    expect(screen.queryByText("Opening External Link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("open report"));

    expect(screen.getByText("Opening External Link")).toBeInTheDocument();
    expect(screen.getByText(URL)).toBeInTheDocument();
  });

  it("loads nothing from the link until the user asks for the preview, and then only in a sandbox", () => {
    renderWithProvider();
    fireEvent.click(screen.getByText("open report"));

    expect(document.querySelector("iframe")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load preview/i }));

    const frame = document.querySelector("iframe");
    expect(frame).toHaveAttribute("src", URL);
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("creates an iframe widget on the active dashboard when choosing 'Open in iframe'", () => {
    renderWithProvider();

    fireEvent.click(screen.getByText("open report"));
    fireEvent.click(screen.getByRole("button", { name: /open in iframe/i }));

    expect(h.addWidget).toHaveBeenCalledWith(
      "dash-1",
      expect.objectContaining({
        widgetId: "iframe",
        storage: { html: URL },
      }),
    );
  });

  it("opens a new tab and does not create a widget when choosing 'Open in new tab'", () => {
    renderWithProvider();

    fireEvent.click(screen.getByText("open report"));
    fireEvent.click(screen.getByRole("button", { name: /open in new tab/i }));

    expect(window.open).toHaveBeenCalledWith(URL, "_blank", "noopener,noreferrer");
    expect(h.addWidget).not.toHaveBeenCalled();
  });

  it("disables the iframe option when no dashboard is active", () => {
    h.dashboardId.current = "";
    renderWithProvider();

    fireEvent.click(screen.getByText("open report"));

    expect(screen.getByRole("button", { name: /open in iframe/i })).toBeDisabled();
  });

  it("ignores modifier-clicks so the browser handles the new tab natively", () => {
    renderWithProvider();

    fireEvent.click(screen.getByText("open report"), { metaKey: true });

    expect(screen.queryByText("Opening External Link")).not.toBeInTheDocument();
  });
});

describe("useExternalLinkAnchorProps", () => {
  it("returns null without a provider (link keeps its native behavior)", () => {
    const { result } = renderHook(() => useExternalLinkAnchorProps(URL));
    expect(result.current).toBeNull();
  });

  it("returns an onClick handler within a provider", () => {
    const { result } = renderHook(() => useExternalLinkAnchorProps(URL), {
      wrapper: ({ children }) => (
        <ExternalLinkProvider>{children}</ExternalLinkProvider>
      ),
    });
    expect(result.current).toEqual({ onClick: expect.any(Function) });
  });
});
