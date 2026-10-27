import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useWidgetContext } from "~/components/Widget.context";
import {
  isApiFileUrl,
  isApiUrl,
  WORKSPACE_CLIENT,
  WORKSPACE_CLIENT_HEADER,
} from "~/lib/utils/fetch";
import { cleanSearchParams, convertHeadersToRecord } from "~/lib/utils/widgetParams";
import { REFRESH_WIDGET_INTERVAL } from "./constants";
import {
  canFetchFromSource,
  SOURCE_UNAVAILABLE_MESSAGE,
  useShallowBackendConnectorStore,
  useWidgetSourceState,
} from "./state/backendConnector";
import { useShallowPermissionsStore } from "./state/permissions";
import { resolveCronRefetchInterval } from "./utils/cronSchedule";

export {
  cleanSearchParams,
  convertHeadersToRecord,
} from "~/lib/utils/widgetParams";

/** What a failed request's JSON body may carry. */
type ApiErrorBody = {
  warnings?: string[];
  detail?: unknown;
  message?: unknown;
  error?: unknown;
  error_kind?: string;
  status?: number;
};

export type TResponseCb<TData> = (
  data: Response,
  resolve: (data: TData | Promise<TData>) => void,
  reject: (reason?: unknown) => void,
) => Promise<void>;

export interface QueryOptions<TQueryFnData = unknown> {
  url: string;
  endpointHeaders?: Record<string, string>;
  params?: { [key: string]: unknown };
  method?: "GET" | "POST";
  asText?: boolean; // If asText is true, the response will be returned as text instead of JSON
  responseCb?: TResponseCb<TQueryFnData>; // Custom resolve callback to handle the response before resolving the promise
  queryKey?: unknown[];
}

export function useJsonData<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
  T extends QueryOptions<TQueryFnData> = QueryOptions<TQueryFnData>,
>(
  queryOptions: T,
  options?: Omit<UseQueryOptions<TQueryFnData, TError, TData>, "queryKey">,
) {
  const {
    url,
    endpointHeaders,
    params = {},
    method = "GET",
    asText = false,
    responseCb,
    queryKey,
  } = queryOptions;
  // Convert endpointHeaders to Record format if necessary
  const { headers, newParams } = convertHeadersToRecord(endpointHeaders, params);
  const {
    widget: {
      id: uuId,
      refreshQuery,
      staleTime,
      refetchInterval,
      sourceId,
      widgetId,
      isSharedWidget,
      sourceName,
      connectionType,
    } = {},
    activeDashboardId,
  } = useWidgetContext(true);

  // A widget whose data backend is not the viewer's waits, or never fetches: it would
  // go out without the backend's credentials
  const sourceState = useWidgetSourceState({
    sourceId,
    connectionType,
    isSharedWidget,
  });
  const sourceReady = canFetchFromSource(sourceState);

  // Check if the widget has permission before making the API call
  const hasAccess = useShallowPermissionsStore((state) =>
    isSharedWidget
      ? state.hasAccess(sourceId ?? "", (widgetId ?? "").replace(`${sourceName}-`, ""))
      : true,
  );

  const updateQueuedRefreshId = useShallowBackendConnectorStore(
    (state) => state.updateQueuedRefreshId,
  );

  const resolveCallback = useCallback<TResponseCb<TQueryFnData>>(
    async (response, resolve, reject) => {
      if (responseCb) {
        try {
          await responseCb(response, resolve, reject);
        } catch (error) {
          reject(error);
        }
        return;
      }
      // Read the response once and use it for both logging and refresh logic
      try {
        const data = asText ? await response.text() : await response.json();

        if (
          !(asText || Array.isArray(data)) &&
          data?.refreshBackend !== undefined &&
          sourceId
        ) {
          // Add or remove the sourceId from the queued refresh ids
          updateQueuedRefreshId(sourceId, data?.refreshBackend);
        }

        resolve(data);
      } catch (error) {
        reject(error);
      }
    },
    [asText, responseCb, sourceId],
  );

  // Clean the URL and add any query parameters
  const cleanUrl = cleanSearchParams(url, newParams);
  const headerKeys = Object.keys(headers || {});
  // The URL comes from a widget: saved or shared content, a data backend, the AI. Only a
  // GET of the API's own file routes gets the FINOS Workspace session; nothing else a widget
  // names is called with it, so a widget cannot act as the viewer on the API.
  const withAuth = method === "GET" && !!cleanUrl && isApiFileUrl(cleanUrl);

  const finalQueryKey = queryKey ?? [
    "json",
    activeDashboardId ?? "",
    cleanUrl || uuId,
    method,
    JSON.stringify(headerKeys),
    refreshQuery ?? 0,
    hasAccess,
    sourceReady,
  ];
  const optionEnabled = options?.enabled;

  return useQuery<TQueryFnData, TError, TData>({
    queryKey: finalQueryKey,
    queryFn: ({ signal }) =>
      new Promise((resolve, reject) => {
        if (!hasAccess) {
          return reject(new Error("User does not have access to this widget"));
        }
        if (!sourceReady) {
          return reject(new Error(SOURCE_UNAVAILABLE_MESSAGE));
        }

        fetch(cleanUrl, {
          headers: {
            ...headers,
            ...(withAuth ? { [WORKSPACE_CLIENT_HEADER]: WORKSPACE_CLIENT } : {}),
          },
          credentials: withAuth ? "include" : "omit",
          method,
          signal,
        })
          .then(async (r) => {
            const noContent = r.status === 204;
            if (!r.ok || noContent) {
              let error: ApiErrorBody | undefined;

              try {
                error = await r.json();
              } catch (_) {
                return reject(r.statusText);
              }

              const warnings = error?.warnings;

              if (warnings?.length)
                for (const warning of warnings) console.warn(warning);

              const errorDetail =
                error?.detail || error?.message || error?.error || error;

              const errorMessage =
                typeof errorDetail === "string"
                  ? errorDetail
                  : JSON.stringify(errorDetail);

              const errorObj = new Error(errorMessage, {
                cause: error?.error_kind || error?.status || "unknown",
              });

              return reject(errorObj);
            }

            resolveCallback(r, resolve, reject);
          })
          .catch((error) => reject(error));
      }),
    staleTime: staleTime ?? 1000 * 60 * 5,
    retry: 1,
    retryDelay: 1000,
    ...(options ?? {}),
    // A caller may hold the request back, never let one through these checks
    enabled: (query) =>
      !!cleanUrl &&
      hasAccess &&
      sourceReady &&
      (typeof optionEnabled === "function"
        ? optionEnabled(query)
        : (optionEnabled ?? true)),
    refetchInterval: resolveCronRefetchInterval(
      refetchInterval,
      options?.refetchInterval ?? REFRESH_WIDGET_INTERVAL,
    ),
  });
}

/**
 * fetch to the FINOS Workspace API with the web session cookie and the client header. It
 * refuses any URL that is not on the API's exact origin, so FINOS Workspace credentials never
 * reach another host.
 */
export function fetchBackend(
  url: string | URL,
  options: RequestInit = {},
  signal?: AbortSignal,
) {
  if (!isApiUrl(url)) {
    return Promise.reject(new Error("fetchBackend only calls the FINOS Workspace API."));
  }
  const headers = new Headers(options.headers);
  headers.set(WORKSPACE_CLIENT_HEADER, WORKSPACE_CLIENT);
  return fetch(url, {
    ...options,
    headers,
    credentials: "include",
    signal: signal ?? options.signal,
  });
}
