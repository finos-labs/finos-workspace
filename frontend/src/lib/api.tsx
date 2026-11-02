import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useWidgetContext } from "~/components/Widget.context";
import {
  fetchRequest,
  isApiFileUrl,
  isApiUrl,
  WORKSPACE_CLIENT,
  WORKSPACE_CLIENT_HEADER,
} from "~/lib/utils/fetch";
import {
  type BuiltRequest,
  RequestProblemsError,
  requestKey,
} from "~/lib/utils/widgetRequest";
import {
  canFetchFromSource,
  SOURCE_UNAVAILABLE_MESSAGE,
  useShallowBackendConnectorStore,
  useWidgetSourceState,
} from "./state/backendConnector";
import { useShallowPermissionsStore } from "./state/permissions";
import { resolveCronRefetchInterval } from "./utils/cronSchedule";
import { jitteredRefreshInterval } from "./utils/refreshInterval";

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
  request: BuiltRequest | null;
  asText?: boolean;
  responseCb?: TResponseCb<TQueryFnData>;
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
  const { request, asText = false, responseCb, queryKey } = queryOptions;
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

  const sourceState = useWidgetSourceState({
    sourceId,
    connectionType,
    isSharedWidget,
  });
  const sourceReady = canFetchFromSource(sourceState);

  const hasAccess = useShallowPermissionsStore((state) =>
    isSharedWidget
      ? state.hasAccess(sourceId ?? "", (widgetId ?? "").replace(`${sourceName}-`, ""))
      : true,
  );
  const sent = request?.ok ? request.request : null;
  const withAuth = !!sent && sent.method === "GET" && isApiFileUrl(sent.url);
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
      try {
        const data = asText ? await response.text() : await response.json();

        if (
          !(asText || Array.isArray(data)) &&
          data?.refreshBackend !== undefined &&
          sourceId
        ) {
          updateQueuedRefreshId(sourceId, data?.refreshBackend);
        }

        resolve(data);
      } catch (error) {
        reject(error);
      }
    },
    [asText, responseCb, sourceId],
  );

  const finalQueryKey = queryKey ?? [
    "json",
    activeDashboardId ?? "",
    ...(request ? requestKey(request) : [uuId ?? ""]),
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
        if (!request) return reject(new Error("Nothing to request"));
        if (!request.ok) return reject(new RequestProblemsError(request.problems));

        fetchRequest(request.request, {
          signal,
          credentials: withAuth ? "include" : "omit",
          headers: withAuth ? { [WORKSPACE_CLIENT_HEADER]: WORKSPACE_CLIENT } : {},
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
              const retryAfter = Number(r.headers.get("retry-after"));
              if (Number.isFinite(retryAfter) && retryAfter > 0)
                Object.assign(errorObj, {
                  retryAfterMs: Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS) * 1000,
                });

              return reject(errorObj);
            }

            resolveCallback(r, resolve, reject);
          })
          .catch((error) => reject(error));
      }),
    staleTime: staleTime ?? 1000 * 60 * 5,
    retry: (failures, error) =>
      !(error instanceof RequestProblemsError) &&
      failures < (retryAfterOf(error) ? MAX_RETRIES_WHEN_TOLD : 1),
    retryDelay: (_failures, error) => retryAfterOf(error) ?? 1000,
    ...(options ?? {}),
    enabled: (query) =>
      !!request &&
      hasAccess &&
      sourceReady &&
      (typeof optionEnabled === "function"
        ? optionEnabled(query)
        : (optionEnabled ?? true)),
    refetchInterval: resolveCronRefetchInterval(
      refetchInterval,
      options?.refetchInterval ?? jitteredRefreshInterval,
    ),
  });
}

const MAX_RETRY_AFTER_SECONDS = 60;
const MAX_RETRIES_WHEN_TOLD = 3;

function retryAfterOf(error: unknown): number | undefined {
  return (error as { retryAfterMs?: number } | null)?.retryAfterMs;
}

export function fetchBackend(
  url: string | URL,
  options: RequestInit = {},
  signal?: AbortSignal,
) {
  if (!isApiUrl(url)) {
    return Promise.reject(
      new Error("fetchBackend only calls the FINOS Workspace API."),
    );
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
