import { lazy } from "react";
import type { WidgetsIds } from "~/lib/utils/widget";

const MarkdownFC = lazy(() => import("./custom/Markdown"));
const IframeFC = lazy(() => import("./Iframe"));
const NewsFC = lazy(() => import("./custom/News"));
const PdfViewerFC = lazy(() => import("./PdfViewer"));
const HtmlViewerFC = lazy(() => import("./custom/HtmlViewer"));
const NavigationBarFC = lazy(() => import("./ui/NavigationBar"));

export const WidgetComponentMap = {
  iframe: "Iframe",
  markdown: "Markdown",
  newsfeed: "News",
  pdf: "PdfViewer",
  html: "HtmlViewer",
  navigation_bar: "NavigationBar",
} as const;

export const Widgets = {
  Markdown: MarkdownFC,
  Iframe: IframeFC,
  News: NewsFC,
  PdfViewer: PdfViewerFC,
  HtmlViewer: HtmlViewerFC,
  NavigationBar: NavigationBarFC,
} as const;

export default Widgets;

export type WidgetComponentName = keyof typeof Widgets;
export type WidgetComponent<T extends WidgetComponentName> = (typeof Widgets)[T];

/** The ids the FINOS Workspace knows, and any other id a backend declares. */
export type WidgetId = keyof typeof WidgetComponentMap | WidgetsIds | (string & {});

export const getWidgetComponent = (
  widgetId: WidgetId,
): WidgetComponent<WidgetComponentName> | undefined => {
  const name = (WidgetComponentMap as Record<string, WidgetComponentName | undefined>)[
    widgetId
  ];
  return name ? Widgets[name] : undefined;
};
