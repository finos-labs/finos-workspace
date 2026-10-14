import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useWidgetContext } from "~/components/Widget.context";
import {
  type BuiltRequest,
  RequestProblemsError,
  requestInit,
  requestKey,
} from "~/lib/utils/widgetRequest";
import { REFRESH_WIDGET_INTERVAL } from "./constants";
import { getConfig } from "./runtimeConfig";
import { useAuthStore, useShallowAuthStore } from "./state/auth";
import { useShallowBackendConnectorStore } from "./state/backendConnector";
import { useShallowPermissionsStore } from "./state/permissions";
import { resolveCronRefetchInterval } from "./utils/cronSchedule";
import { toError } from "./utils/utils";

export { convertHeadersToRecord } from "~/lib/utils/widgetParams";

function isBackendOrigin(url: string) {
  return url?.includes(getConfig().urls.backend);
}

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
  /** What to send (`widgetRequest.ts`); null sends nothing */
  request: BuiltRequest | null;
  asText?: boolean; // If asText is true, the response will be returned as text instead of JSON
  responseCb?: TResponseCb<TQueryFnData>; // Custom resolve callback to handle the response before resolving the promise
  addBearerToken?: boolean; // Adds User Bearer token to the request Authorization header
  queryKey?: unknown[];
  onError?: (error: Error) => void;
  ignoreRefresh?: boolean;
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
    request,
    asText = false,
    responseCb,
    addBearerToken = true,
    queryKey,
    onError,
    ignoreRefresh = false,
  } = queryOptions;
  const userToken = useShallowAuthStore((authState) => authState.user?.token);
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
    } = {},
    activeDashboardId,
  } = useWidgetContext(true);

  // Check if the widget has permission before making the API call
  const hasAccess = useShallowPermissionsStore((state) =>
    isSharedWidget
      ? state.hasAccess(sourceId ?? "", (widgetId ?? "").replace(`${sourceName}-`, ""))
      : true,
  );
  const withAuth =
    addBearerToken && request?.ok && isBackendOrigin(request.request.url);
  const updateQueuedRefreshId = useShallowBackendConnectorStore(
    (state) => state.updateQueuedRefreshId,
  );

  const resolveCallback = useCallback<TResponseCb<TQueryFnData>>(
    async (response, resolve, reject) => {
      if (responseCb) {
        try {
          await responseCb(response, resolve, reject);
        } catch (error) {
          onError?.(toError(error));
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
        onError?.(toError(error));
        reject(error);
      }
    },
    [asText, responseCb, onError, sourceId],
  );

  const finalQueryKey = queryKey ?? [
    "json",
    activeDashboardId ?? "",
    ...(request ? requestKey(request) : [uuId ?? ""]),
    ...(ignoreRefresh ? [] : [refreshQuery ?? 0]),
    hasAccess,
  ];

  return useQuery<TQueryFnData, TError, TData>({
    queryKey: finalQueryKey,
    queryFn: ({ signal }) =>
      new Promise((resolve, reject) => {
        if (!hasAccess) {
          return reject(new Error("User does not have access to this widget"));
        }
        if (!request) return reject(new Error("Nothing to request"));
        // A param needs a value, or has one that cannot be sent: nothing goes out
        if (!request.ok) return reject(new RequestProblemsError(request.problems));

        fetch(
          request.request.url,
          requestInit(request.request, {
            signal,
            headers:
              withAuth && userToken ? { Authorization: `Bearer ${userToken}` } : {},
          }),
        )
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

              onError?.(errorObj);
              return reject(errorObj);
            }

            resolveCallback(r, resolve, reject);
          })
          .catch((error) => {
            onError?.(toError(error));
            reject(error);
          });
      }),
    staleTime: staleTime ?? 1000 * 60 * 5,
    retry: (failures, error) =>
      !(error instanceof RequestProblemsError) && failures < 1,
    retryDelay: 1000,
    ...(options ?? {}),
    // Nothing to request, or no access: the caller cannot turn it on
    enabled: !!request && hasAccess && options?.enabled !== false,
    refetchInterval: resolveCronRefetchInterval(
      refetchInterval,
      options?.refetchInterval ?? REFRESH_WIDGET_INTERVAL,
    ),
  });
}

export function fetchWithToken(
  url: string | URL,
  options: RequestInit = {},
  signal?: AbortSignal,
) {
  const token = useAuthStore.getState().user?.token;

  if (!token) return Promise.reject(new Error("No token found"));
  return fetch(url, {
    ...(options ?? {}),
    headers: {
      ...(options?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
    signal,
  });
}
