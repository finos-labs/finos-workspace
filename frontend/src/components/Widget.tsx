import { lazy, Suspense, useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import DraggableCard from "~/components/DraggableCard";
import { Button } from "~/components/ds/atoms/Button";
import { useWidgetParamsPositions } from "~/components/WidgetParams/QueryParams";
import { FILE_EXTENSIONS } from "~/lib/constants";
import { useTabContext } from "~/lib/contexts/TabContext";
import { useAppStore } from "~/lib/state/app";
import { isBuiltInVizType, isWellFormedVizType } from "~/lib/types/app";
import { getCleanWidgetId } from "~/lib/utils";
import EmptyDashboardCTA from "./General/EmptyDashboardCTA";
import SearchResultsNotFound from "./General/SearchResultsNotFound";
import RenderIfVisible from "./RenderIfVisible";
import { useWidgetContext, WidgetProvider } from "./Widget.context";
import Widgets, { getWidgetComponent, type WidgetId } from "./Widgets";

const PluginWidget = lazy(() => import("~/plugins/PluginWidget"));

function isPluginRendered(
  widget: { plugin?: unknown; type?: string | null } | undefined,
) {
  if (!widget) return false;
  if (widget.plugin) return true;
  return isWellFormedVizType(widget.type) && !isBuiltInVizType(widget.type);
}

const WidgetFallback = () => {
  const { renderRow0Params, renderBelowNavbarRows } = useWidgetParamsPositions(false);

  return (
    <DraggableCard
      loading={true}
      elementRightNextToTitle={renderRow0Params}
      elementBelowNavbar={renderBelowNavbarRows}
      children={null}
    />
  );
};

export function WidgetWrapper(props: { uuid: string; activeDashboardId: string }) {
  const { uuid, activeDashboardId } = props;

  const { getWidget, isShared } = useTabContext();
  const { widgetId, pluginRendered, ...value } = useMemo(
    () => ({
      uuid,
      isShared,
      activeDashboardId,
      widgetId: getWidget(uuid)?.widgetId,
      pluginRendered: isPluginRendered(getWidget(uuid)),
    }),
    [uuid, activeDashboardId],
  );

  const element = useMemo(
    () => (
      <WidgetProvider {...value}>
        <RenderIfVisible stayRendered={!pluginRendered}>
          <Suspense fallback={<WidgetFallback key={`widget-fallback-${uuid}`} />}>
            <WidgetComponent />
          </Suspense>
        </RenderIfVisible>
      </WidgetProvider>
    ),
    [value, pluginRendered],
  );

  const errorBoundaryProps = useMemo(
    () => ({
      fallback: (
        <div className="flex h-full w-full flex-col items-center justify-center rounded-md border border-general-border-secondary bg-general-bg-primary p-2">
          <SearchResultsNotFound
            firstMessage={`Something went wrong with the widget: ${widgetId ?? uuid}`}
            secondMessage="Please try again later or remove the widget."
            children={
              <Button
                className="mt-2.5"
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (widgetId)
                    useAppStore.getState().removeWidget(activeDashboardId, uuid);
                }}
              >
                Remove widget
              </Button>
            }
          />
        </div>
      ),
    }),
    [uuid, widgetId, activeDashboardId],
  );

  if (uuid === "empty-dashboard-cta") return <EmptyDashboardCTA />;

  return <ErrorBoundary {...errorBoundaryProps}>{element}</ErrorBoundary>;
}

function loadWidgetComponent(widgetId: WidgetId) {
  const Component = getWidgetComponent(widgetId);
  return Component ? <Component /> : null;
}

function WidgetComponent() {
  const { widget, widgetFromJSON } = useWidgetContext();
  if (!widget?.widgetId) {
    return null;
  }

  if (widget.plugin) return <PluginWidget />;

  const endpointUrl = widget?.endpoint?.url;
  const cleanWidgetId = getCleanWidgetId(widget.widgetId, widget.connectionType);

  if (
    cleanWidgetId === "file" &&
    endpointUrl &&
    FILE_EXTENSIONS.some((ext) => endpointUrl.endsWith(ext))
  ) {
    return endpointUrl.endsWith(".pdf") ? (
      <Widgets.PdfViewer />
    ) : endpointUrl.endsWith(".html") ? (
      <Widgets.HtmlViewer />
    ) : (
      <Widgets.Markdown />
    );
  }

  const hasComponent = loadWidgetComponent(cleanWidgetId as WidgetId);

  if (hasComponent) return hasComponent;

  const widgetType = widgetFromJSON?.type ?? widget?.type;
  const widgetTypeComponent = loadWidgetComponent(widgetType as WidgetId);

  if (widgetTypeComponent) return widgetTypeComponent;

  if (isPluginRendered({ type: widgetType })) return <PluginWidget />;

  return (
    <DraggableCard>
      <SearchResultsNotFound
        icon={true}
        firstMessage="Widget is not implemented yet"
        secondMessage={`ID: ${widget.widgetId}`}
      />
    </DraggableCard>
  );
}
