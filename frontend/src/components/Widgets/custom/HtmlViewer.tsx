import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import DraggableCard from "~/components/DraggableCard";
import { useWidgetContext } from "~/components/Widget.context";
import { useWidgetParamsPositions } from "~/components/WidgetParams/QueryParams";
import {
  RowsTable,
  RowsToggle,
  useRawRows,
  useRowsView,
} from "~/components/Widgets/Helpers/RawRows";
import { useParamGroupBindings } from "~/components/Widgets/Helpers/useParamGroupBindings";
import { type QueryOptions, useJsonData } from "~/lib/api";
import { IFRAME_SRCDOC_SANDBOX_ATTRIBUTES } from "~/lib/constants";
import { getConfig } from "~/lib/runtimeConfig";
import { useSourceCredentials } from "~/lib/state/backendConnector";
import { useShallowThemeStore } from "~/lib/state/theme";
import { triggerCustomEvent, useEventListener } from "~/lib/utils";
import { buildWidgetRequest, requestKey } from "~/lib/utils/widgetRequest";
import { useRowsPlugin } from "~/plugins/registry";
import {
  parseIframeParamsMessage,
  stringifyParamValue,
  WIDGET_PARAM_MESSAGE_TYPES,
  type WorkspaceWidgetParamValue,
} from "~/types/iframeProtocol";

const BRIDGE_TOKEN_FIELD = "widgetParamBridgeToken";
const PluginRowsCard = lazy(() =>
  import("~/plugins/PluginWidget").then((module) => ({
    default: module.PluginRowsCard,
  })),
);

function getWidgetParamBridgeToken(data: unknown) {
  if (!data || typeof data !== "object") return undefined;
  const token = (data as Record<string, unknown>)[BRIDGE_TOKEN_FIELD];
  return typeof token === "string" ? token : undefined;
}

function createWidgetParamBridgeScript(token: string) {
  const tokenJson = JSON.stringify(token).replace(/</g, "\\u003c");
  const eventTypesJson = JSON.stringify(WIDGET_PARAM_MESSAGE_TYPES).replace(
    /</g,
    "\\u003c",
  );
  return `<script>(()=>{const token=${tokenJson};const types=${eventTypesJson};const forward=(event)=>{const detail=event&&event.detail;if(!detail||typeof detail!=="object")return;window.parent?.postMessage({...detail,${BRIDGE_TOKEN_FIELD}:token},"*")};for(const t of types)window.addEventListener(t,forward);})();</script>`;
}

function injectWidgetParamBridge(html: string, token: string) {
  const bridge = createWidgetParamBridgeScript(token);
  if (/<body(\s|>)/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${bridge}`);
  }
  return `${bridge}${html}`;
}

function filterAllowedParams(
  params: Record<string, WorkspaceWidgetParamValue> | undefined,
  allowedParams: Set<string>,
) {
  return Object.fromEntries(
    Object.entries(params ?? {}).filter(([paramName]) => allowedParams.has(paramName)),
  );
}

export default function HtmlViewer() {
  const allowJsExecution = getConfig().data.allowHtmlJsExecution;
  const { widget, widgetFromJSON, updateWidget } = useWidgetContext();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeBridgeTokenRef = useRef(`html-${crypto.randomUUID()}`);
  const latestIframeParamsRef = useRef<Record<string, WorkspaceWidgetParamValue>>({});
  const theme = useShallowThemeStore((s) => s.theme);

  const staticHtml: string | undefined = widget?.storage?.html;
  const isStaticMode = !!staticHtml;

  const credentials = useSourceCredentials(widget.sourceId, widget.endpoint?.url);

  const options = useMemo<QueryOptions<string>>(() => {
    const request = buildWidgetRequest(widget, credentials, { theme });
    return {
      request,
      asText: true,
      queryKey:
        widget.runButton && request
          ? ["html", widget.id, ...requestKey(request), widget.refreshQuery ?? 0]
          : undefined,
    };
  }, [
    widget.id,
    widget.runButton,
    widget.refreshQuery,
    widget.endpoint,
    widget.params,
    widget.storage?.params,
    theme,
    credentials,
  ]);

  const allowedFilterParams = useMemo(() => {
    const params = widget?.params ?? widgetFromJSON?.params ?? [];

    return new Set(params.map((param) => param.paramName).filter(Boolean));
  }, [widget?.params, widgetFromJSON?.params]);

  const { updateGroupedParams: updateGroupBindings } = useParamGroupBindings({
    includeDashboardGroups: true,
    filterAllowedParams: true,
  });

  const updateGroupedParams = useCallback(
    (params: Record<string, WorkspaceWidgetParamValue>) => {
      updateGroupBindings(
        Object.fromEntries(
          Object.entries(params).map(([paramName, value]) => [
            paramName,
            stringifyParamValue(value),
          ]),
        ),
      );
    },
    [updateGroupBindings],
  );

  const updateIframeParams = useCallback(
    (params: Record<string, WorkspaceWidgetParamValue>, refresh = false) => {
      if (Object.keys(params).length === 0) return;

      updateWidget(
        (prev) => ({
          ...prev,
          ...(refresh ? { refreshQuery: Date.now() } : {}),
          storage: {
            ...prev.storage,
            params: {
              ...(prev.storage?.params ?? {}),
              ...params,
            },
          },
        }),
        true,
      );
    },
    [updateWidget],
  );

  const handleIframeParamsData = useCallback(
    (data: unknown) => {
      const parsed = parseIframeParamsMessage(data);
      if (!parsed) return;

      const nextParams = filterAllowedParams(parsed, allowedFilterParams);
      if (Object.keys(nextParams).length === 0) return;

      const mergedParams = {
        ...filterAllowedParams(widget.storage?.params, allowedFilterParams),
        ...latestIframeParamsRef.current,
        ...nextParams,
      };
      latestIframeParamsRef.current = mergedParams;

      triggerCustomEvent(`updateQueryParams-${widget.id}`, mergedParams);
      updateGroupedParams(mergedParams);
      updateIframeParams(mergedParams);
    },
    [
      latestIframeParamsRef,
      allowedFilterParams,
      updateGroupedParams,
      updateIframeParams,
      widget.id,
      widget.storage?.params,
    ],
  );
  useEffect(() => {
    if (!allowJsExecution) return;

    const handleMessage = (event: MessageEvent) => {
      const isCurrentIframe =
        event.source === iframeRef.current?.contentWindow ||
        getWidgetParamBridgeToken(event.data) === iframeBridgeTokenRef.current;
      if (!isCurrentIframe) return;

      handleIframeParamsData(event.data);
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [allowJsExecution, handleIframeParamsData]);

  const {
    data: htmlData,
    isLoading: htmlLoading,
    error: htmlError,
    dataUpdatedAt,
  } = useJsonData<string>(options, {
    enabled: !isStaticMode,
    staleTime: widget?.staleTime ?? 1000 * 60 * 15,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  });

  const rows = useRawRows(widget);
  const [showRows, setShowRows] = useRowsView();
  const rowsPlugin = useRowsPlugin(widget.data?.rawType);

  const data = isStaticMode ? staticHtml : htmlData;
  const isLoading = isStaticMode ? false : htmlLoading;
  const error = isStaticMode ? null : htmlError;
  const iframeData = useMemo(
    () =>
      allowJsExecution && typeof data === "string"
        ? injectWidgetParamBridge(data, iframeBridgeTokenRef.current)
        : data,
    [allowJsExecution, data],
  );

  const { renderRow0Params, renderBelowNavbarRows } = useWidgetParamsPositions();

  const handleRunParams = useCallback(
    () => updateIframeParams(latestIframeParamsRef.current, true),
    [updateIframeParams, latestIframeParamsRef],
  );
  useEventListener(`runParams-${widget.id}`, handleRunParams);

  const hasRows = !isStaticMode && widget.raw === true;
  const rowsShown = hasRows && showRows;

  if (rowsShown && rowsPlugin)
    return (
      <Suspense fallback={null}>
        <PluginRowsCard resolved={rowsPlugin} viewName="HTML" />
      </Suspense>
    );

  return (
    <DraggableCard
      title={widget.name}
      aiEnabled={true}
      aiData={isStaticMode ? staticHtml : hasRows ? rows.data : htmlData}
      elementRightNextToTitle={renderRow0Params}
      elementBelowNavbar={renderBelowNavbarRows}
      extraNavbarElements={
        hasRows ? (
          <RowsToggle showRows={showRows} onChange={setShowRows} viewName="HTML" />
        ) : null
      }
      lastUpdated={rowsShown ? rows.dataUpdatedAt : dataUpdatedAt}
      loading={rowsShown ? rows.isLoading : isLoading}
      error={rowsShown ? rows.error : error || !data}
      errorMessage={
        rowsShown
          ? rows.error?.message
          : widget?.external
            ? error?.message
            : "No results found"
      }
    >
      {rowsShown ? (
        <RowsTable rows={rows.data} />
      ) : (
        data && (
          <iframe
            ref={iframeRef}
            srcDoc={iframeData}
            className="w-full h-full border-0"
            sandbox={allowJsExecution ? IFRAME_SRCDOC_SANDBOX_ATTRIBUTES : ""}
            title={widget.name}
          />
        )
      )}
    </DraggableCard>
  );
}
