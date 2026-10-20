import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DraggableCard from "~/components/DraggableCard";
import Icon from "~/components/Icon";
import Tooltip from "~/components/Tooltip";
import { useWidgetContext } from "~/components/Widget.context";
import { useWidgetParamsPositions } from "~/components/WidgetParams/QueryParams";
import { useParamGroupBindings } from "~/components/Widgets/Helpers/useParamGroupBindings";
import { type QueryOptions, useJsonData } from "~/lib/api";
import { IFRAME_SRCDOC_SANDBOX_ATTRIBUTES } from "~/lib/constants";
import { getConfig } from "~/lib/runtimeConfig";
import { useSourceCredentials } from "~/lib/state/backendConnector";
import { useShallowThemeStore } from "~/lib/state/theme";
import { cn, triggerCustomEvent, useEventListener } from "~/lib/utils";
import { buildWidgetRequest, requestKey } from "~/lib/utils/widgetRequest";
import {
  parseIframeParamsMessage,
  stringifyParamValue,
  WIDGET_PARAM_MESSAGE_TYPES,
  type WorkspaceWidgetParamValue,
} from "~/types/iframeProtocol";

const BRIDGE_TOKEN_FIELD = "widgetParamBridgeToken";
const RAW_DATA_STALE_TIME = 0;

function getWidgetParamBridgeToken(data: unknown) {
  if (!data || typeof data !== "object") return undefined;
  const token = (data as Record<string, unknown>)[BRIDGE_TOKEN_FIELD];
  return typeof token === "string" ? token : undefined;
}

/**
 * Builds the inline `<script>` injected into HtmlViewer's srcDoc so the inner
 * page can dispatch CustomEvents that get forwarded to the parent via
 * postMessage. The unique `token` lets the parent confirm a forwarded message
 * came from this widget's iframe (belt-and-braces on top of `event.source`).
 * Forwarded message types are kept in sync with WIDGET_PARAM_MESSAGE_TYPES.
 */
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

  // Static HTML mode: content stored directly in widget.storage.html (from copilot artifacts)
  const staticHtml: string | undefined = widget?.storage?.html;
  const isStaticMode = !!staticHtml;

  const rawDataView = widget?.storage?.rawDataView ?? false;
  const hasRawFlag = widget?.raw;

  const setRawDataView = useCallback(
    (enabled: boolean) => {
      updateWidget((prev) => ({
        ...prev,
        storage: {
          ...prev.storage,
          rawDataView: enabled,
        },
      }));
    },
    [updateWidget],
  );
  const [rawData, setRawData] = useState<unknown>(null);
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
  // The iframe runs in an opaque origin (its sandbox has no allow-same-origin), so the
  // injected bridge script is how its events reach the page: by postMessage
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

  // The raw query is not run without the flag; raw data is JSON, not text
  const rawDataOptions = useMemo<QueryOptions>(
    () => ({
      request: hasRawFlag
        ? buildWidgetRequest(widget, credentials, { theme, raw: "true" })
        : null,
    }),
    [hasRawFlag, widget.endpoint, widget.params, widget.storage?.params, theme],
  );

  // The raw data view sends `raw: true` to the backend; the widget keeps showing the HTML.
  const { data: rawDataResponse } = useJsonData<unknown>(rawDataOptions, {
    enabled: (rawDataView && hasRawFlag) === true,
    staleTime: RAW_DATA_STALE_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  });

  // In static mode, use the stored HTML directly; otherwise use fetched data
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

  useEffect(() => {
    if (rawDataResponse && hasRawFlag) {
      const processedRawData =
        (typeof rawDataResponse === "object" && "results" in rawDataResponse
          ? rawDataResponse.results
          : undefined) ?? rawDataResponse;
      setRawData(processedRawData);
    } else if (!hasRawFlag) {
      setRawData(null);
    }
  }, [rawDataResponse, hasRawFlag]);

  const { renderRow0Params, renderBelowNavbarRows } = useWidgetParamsPositions();

  const handleRunParams = useCallback(
    () => updateIframeParams(latestIframeParamsRef.current, true),
    [updateIframeParams, latestIframeParamsRef],
  );
  useEventListener(`runParams-${widget.id}`, handleRunParams);

  const rawDataToggle = useMemo(() => {
    // No raw data toggle in static mode or if no raw flag
    if (isStaticMode || !hasRawFlag) return null;

    return (
      <Tooltip message={`Switch to ${rawDataView ? "HTML" : "raw data"} view`}>
        <button
          onClick={() => setRawDataView(!rawDataView)}
          className={cn("ws-small-navbar-btn", {
            "bg-brand-main! text-white! hover:bg-brand-main!": !rawDataView,
          })}
          aria-label={`Switch to ${rawDataView ? "HTML" : "raw data"} view`}
          id="raw-data-toggle-button"
        >
          <Icon id="database-icon" className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    );
  }, [isStaticMode, hasRawFlag, rawDataView, setRawDataView]);

  return (
    <DraggableCard
      title={widget.name}
      aiEnabled={true}
      aiData={isStaticMode ? staticHtml : hasRawFlag && rawData ? rawData : htmlData}
      elementRightNextToTitle={renderRow0Params}
      elementBelowNavbar={renderBelowNavbarRows}
      extraNavbarElements={rawDataToggle}
      lastUpdated={dataUpdatedAt}
      loading={isLoading}
      error={error || !data}
      errorMessage={widget?.external ? error?.message : "No results found"}
    >
      {data && (
        <iframe
          ref={iframeRef}
          srcDoc={iframeData}
          className="w-full h-full border-0"
          sandbox={allowJsExecution ? IFRAME_SRCDOC_SANDBOX_ATTRIBUTES : ""}
          title={widget.name}
        />
      )}
    </DraggableCard>
  );
}
