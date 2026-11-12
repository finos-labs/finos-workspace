import { lazy } from "react";
import type { WidgetsIds } from "~/lib/utils/widget";

const MarkdownFC = lazy(() => import("./custom/Markdown"));
const IframeFC = lazy(() => import("./Iframe"));
const NewsFC = lazy(() => import("./custom/News"));
const PdfViewerFC = lazy(() => import("./PdfViewer"));
const HtmlViewerFC = lazy(() => import("./custom/HtmlViewer"));
const NavigationBarFC = lazy(() => import("./ui/NavigationBar"));
const McpAppFC = lazy(() => import("./McpApp/McpAppWidget"));

export const WidgetComponentMap = {
  iframe: "Iframe",
  markdown: "Markdown",
  newsfeed: "News",
  pdf: "PdfViewer",
  html: "HtmlViewer",
  navigation_bar: "NavigationBar",
  mcp_app: "McpApp",
} as const;

const Widgets = {
  Markdown: MarkdownFC,
  Iframe: IframeFC,
  News: NewsFC,
  PdfViewer: PdfViewerFC,
  HtmlViewer: HtmlViewerFC,
  NavigationBar: NavigationBarFC,
  McpApp: McpAppFC,
} as const;

export default Widgets;

type WidgetComponentName = keyof typeof Widgets;
type WidgetComponent<T extends WidgetComponentName> = (typeof Widgets)[T];

export type WidgetId = keyof typeof WidgetComponentMap | WidgetsIds | (string & {});

export const getWidgetComponent = (
  widgetId: WidgetId,
): WidgetComponent<WidgetComponentName> | undefined => {
  const name = (WidgetComponentMap as Record<string, WidgetComponentName | undefined>)[
    widgetId
  ];
  return name ? Widgets[name] : undefined;
};
