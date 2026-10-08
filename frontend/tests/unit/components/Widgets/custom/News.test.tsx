import { fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { useWidgetContext } from "~/components/Widget.context";
import News from "~/components/Widgets/custom/News";
import { useJsonData } from "~/lib/api";

const mockAddWidget = vi.fn();

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: vi.fn(),
}));

vi.mock("~/lib/api", () => ({
  useJsonData: vi.fn(),
}));

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: (selector: (state: { addWidget: Mock }) => unknown) =>
    selector({ addWidget: mockAddWidget }),
}));

vi.mock("~/components/WidgetParams/QueryParams", () => ({
  useWidgetParamsPositions: () => ({
    renderRow0Params: null,
    renderBelowNavbarRows: null,
  }),
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/Widgets/custom/Markdown", () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="article-body">{content}</div>
  ),
}));

vi.mock("~/components/DraggableCard", () => ({
  __esModule: true,
  default: ({
    children,
    elementNextToTitle,
    error,
  }: {
    children: React.ReactNode;
    elementNextToTitle?: React.ReactNode;
    error?: unknown;
  }) => (
    <div data-testid="draggable-card" data-error={String(Boolean(error))}>
      {elementNextToTitle}
      {children}
    </div>
  ),
}));

const articles = [
  {
    title: "Rates held steady",
    excerpt: "The committee left rates unchanged on Wednesday.",
    date: "2026-03-04T09:30:00Z",
    author: "A. Writer",
    body: "# Rates\n\nThe committee left rates unchanged.",
  },
  {
    title: "Harvest outlook improves",
    excerpt: "Forecasts for the autumn harvest were raised.",
    date: "2026-03-05T12:00:00Z",
    author: "B. Reporter",
    body: "Forecasts were raised.",
  },
];

const widget = {
  name: "Headlines",
  innerTab: "tab-1",
  endpoint: { url: "https://backend.test/headlines", headers: {}, method: "GET" },
  data: { dataKey: "items" },
};

function mockData(data: unknown, extra: Record<string, unknown> = {}) {
  (useJsonData as Mock).mockReturnValue({
    data,
    isLoading: false,
    error: null,
    dataUpdatedAt: 1,
    ...extra,
  });
}

describe("News widget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useWidgetContext as Mock).mockReturnValue({
      widget,
      activeDashboardId: "dashboard-1",
    });
    mockData(articles);
  });

  it("lists each article with its author", () => {
    render(<News />);

    expect(screen.getByText("Rates held steady")).toBeInTheDocument();
    expect(screen.getByText("Harvest outlook improves")).toBeInTheDocument();
    expect(screen.getByText("A. Writer")).toBeInTheDocument();
    expect(screen.getByText("B. Reporter")).toBeInTheDocument();
  });

  it("reads the articles from the widget's data key", async () => {
    render(<News />);

    const { responseCb } = (useJsonData as Mock).mock.calls[0][0] as {
      responseCb: (r: Response, resolve: (v: unknown) => unknown) => Promise<unknown>;
    };
    const resolved = await responseCb(
      new Response(JSON.stringify({ items: articles })),
      (value) => value,
    );

    expect(resolved).toEqual(articles);
  });

  it("filters by title or excerpt as the user types", () => {
    render(<News />);

    fireEvent.change(screen.getByPlaceholderText("Search articles..."), {
      target: { value: "harvest" },
    });

    expect(screen.queryByText("Rates held steady")).not.toBeInTheDocument();
    expect(screen.getByText("Harvest outlook improves")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search articles..."), {
      target: { value: "unchanged" },
    });

    expect(screen.getByText("Rates held steady")).toBeInTheDocument();
    expect(screen.queryByText("Harvest outlook improves")).not.toBeInTheDocument();
  });

  it("shows the empty state when the endpoint does not return a list", () => {
    mockData({ message: "not a list" });

    render(<News />);

    expect(screen.getByTestId("draggable-card")).toHaveAttribute("data-error", "true");
  });

  it("opens an article in a dialog", () => {
    render(<News />);

    fireEvent.click(screen.getByText("Rates held steady"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Rates held steady")).toBeInTheDocument();
    expect(within(dialog).getByText("A. Writer")).toBeInTheDocument();
    expect(within(dialog).getByTestId("article-body")).toHaveTextContent(
      "The committee left rates unchanged.",
    );
  });

  it("puts the article on the dashboard as a markdown widget", () => {
    render(<News />);
    fireEvent.click(screen.getByText("Harvest outlook improves"));

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Open as a Widget on the Dashboard",
      }),
    );

    expect(mockAddWidget).toHaveBeenCalledTimes(1);
    const [dashboardId, added] = mockAddWidget.mock.calls[0];
    expect(dashboardId).toBe("dashboard-1");
    expect(added).toMatchObject({
      name: "Harvest outlook improves",
      widgetId: "markdown",
      innerTab: "tab-1",
      storage: { text: "Forecasts were raised." },
    });
  });
});
