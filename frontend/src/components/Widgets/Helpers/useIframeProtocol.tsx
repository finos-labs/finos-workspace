import isEqual from "lodash.isequal";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useWidgetContext } from "~/components/Widget.context";
import { useStateReducer } from "~/hooks/useStateReducer";
import { useSourceCredentials } from "~/lib/state/backendConnector";
import { convertHeadersToRecord } from "~/lib/utils/widgetParams";
import {
  isWidgetParamMessageType,
  parseIframeParamsMessage,
  stringifyParamValue,
  type WorkspaceAuthMessage,
  WorkspaceConnectMessageSchema,
  type WorkspaceDataMessage,
  WorkspaceDataMessageSchema,
  WorkspaceErrorMessageSchema,
  type WorkspaceParamDef,
  type WorkspaceParamsUpdateMessage,
  type WorkspaceRequestMessage,
  type WorkspaceWidgetManifest,
} from "~/types/iframeProtocol";

const REQUEST_TIMEOUT_MS = 10_000;

interface UseIframeProtocolOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onAiData?: (data: string) => void;
  onParamsUpdate?: (params: Record<string, string>) => void;
}

const getIframeOrigin = (iframeRef: React.RefObject<HTMLIFrameElement | null>) => {
  try {
    return new URL(iframeRef.current?.src ?? "").origin;
  } catch {
    return null;
  }
};

/** How many frames deep a page may nest its content (and still be taken for the widget's iframe). */
const MAX_FRAME_DEPTH = 8;

/**
 * Whether `source` is `frame` or a frame inside it. A page that nests its content in sub-iframes (Streamlit
 * does) sends from one of those, so the widget's own window is somewhere up its parent chain. Two iframes of
 * the same origin are not each other's: judging by origin made every widget take the messages (and the
 * handshake) of its siblings for its own.
 */
function isWindowWithin(
  source: MessageEventSource | null,
  frame: Window | null | undefined,
): boolean {
  if (!(source && frame)) return false;
  let current = source as Window;
  for (let depth = 0; depth < MAX_FRAME_DEPTH; depth++) {
    if (current === frame) return true;
    let parent: Window | null | undefined;
    try {
      parent = current.parent;
    } catch {
      return false;
    }
    if (!parent || parent === current) return false;
    current = parent;
  }
  return false;
}

type PendingRequest = {
  resolve: (msg: WorkspaceDataMessage) => void;
  reject: (err: Error) => void;
};

export function useIframeProtocol(params: UseIframeProtocolOptions) {
  const { iframeRef, onAiData, onParamsUpdate } = params;
  const [state, dispatch] = useStateReducer({
    manifest: null as WorkspaceWidgetManifest[] | null,
    paramDefs: null as WorkspaceParamDef[] | null,
  });
  // The source's headers, from page memory: the iframe gets them at its handshake, and
  // again whenever they change after it (after a reload they arrive from the API later)
  // The iframe page is the widget's endpoint: it gets them only on its source's origin
  const widget = useWidgetContext()?.widget;
  const authHeaders = useSourceCredentials(
    widget?.sourceId,
    widget?.endpoint?.url,
  ).headers;
  const authHeadersRef = useRef(authHeaders);
  authHeadersRef.current = authHeaders;

  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());

  // Store the actual source window from the handshake message.
  // Needed because iframes like Streamlit nest content in sub-iframes,
  // so event.source won't be iframeRef.current.contentWindow.
  const bridgeSourceRef = useRef<MessageEventSource | null>(null);
  // Store the origin from the handshake to scope outgoing postMessage calls.
  const bridgeOriginRef = useRef<string>("*");

  /** Posts the source's headers to the iframe's page that made the handshake, when there are any. */
  const postAuth = useCallback(
    (
      target: MessageEventSource | null,
      origin: string,
      sourceHeaders: Record<string, string>,
    ) => {
      const { headers } = convertHeadersToRecord(sourceHeaders);
      if (!target || Object.keys(headers).length === 0) return;
      if (origin !== getIframeOrigin(iframeRef)) return;
      const message: WorkspaceAuthMessage = { type: "workspace-auth", headers };
      (target as Window).postMessage(message, origin);
      console.debug("[iframe-protocol] sent workspace-auth to", origin);
    },
    [iframeRef],
  );

  const isFromIframe = useCallback(
    (event: MessageEvent) => {
      if (event.source === iframeRef.current?.contentWindow) return true;
      if (bridgeSourceRef.current && event.source === bridgeSourceRef.current)
        return true;

      return isWindowWithin(event.source, iframeRef.current?.contentWindow);
    },
    [iframeRef, bridgeSourceRef],
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const { data } = event;
      if (!data?.type) return;

      const isWorkspaceMessage =
        data.type === "workspace-connect" ||
        data.type === "workspace-data" ||
        data.type === "workspace-error" ||
        data.type === "aiData" ||
        isWidgetParamMessageType(data.type);
      if (!isWorkspaceMessage) return;

      const fromIframe = isFromIframe(event);

      console.debug("[iframe-protocol] message received", {
        type: data.type,
        fromIframe,
        origin: event.origin,
      });

      if (!fromIframe) return;

      if (data.type === "workspace-connect") {
        const parsed = WorkspaceConnectMessageSchema.safeParse(data);
        if (!parsed.success) {
          console.warn(
            "[iframe-protocol] invalid workspace-connect message — check your widget manifest.",
            parsed.error.issues,
          );
          return;
        }
        const msg = parsed.data;
        bridgeSourceRef.current = event.source;
        bridgeOriginRef.current = event.origin || "*";
        console.debug(
          "[iframe-protocol] handshake received, widgets:",
          msg.widgets,
          "params:",
          msg.params,
        );

        const stateUpdates = { manifest: msg.widgets, paramDefs: msg.params ?? null };

        dispatch((prev) => {
          if (!isEqual(prev, stateUpdates)) {
            return stateUpdates;
          }
          return prev;
        });

        postAuth(event.source, event.origin, authHeadersRef.current);
        return;
      }

      if (data.type === "workspace-data") {
        const parsed = WorkspaceDataMessageSchema.safeParse(data);
        if (!parsed.success) {
          console.warn(
            "[iframe-protocol] invalid workspace-data message — check your data response shape.",
            parsed.error.issues,
          );
          return;
        }
        const msg = parsed.data;
        console.debug("[iframe-protocol] data received for widget:", msg.widgetId);
        const pending = pendingRequestsRef.current.get(msg.widgetId);
        if (pending) {
          pendingRequestsRef.current.delete(msg.widgetId);
          pending.resolve(msg);
        }
        return;
      }

      if (data.type === "workspace-error") {
        const parsed = WorkspaceErrorMessageSchema.safeParse(data);
        if (!parsed.success) {
          console.warn(
            "[iframe-protocol] invalid workspace-error message.",
            parsed.error.issues,
          );
          return;
        }
        const msg = parsed.data;
        console.debug(
          "[iframe-protocol] error received for widget:",
          msg.widgetId,
          msg.error,
        );
        const pending = pendingRequestsRef.current.get(msg.widgetId);
        if (pending) {
          pendingRequestsRef.current.delete(msg.widgetId);
          pending.reject(new Error(msg.error));
        }
        return;
      }

      if (data.type === "aiData") {
        console.debug("[iframe-protocol] aiData received");
        onAiData?.(JSON.stringify(data.data));
        return;
      }

      if (isWidgetParamMessageType(data.type)) {
        const parsed = parseIframeParamsMessage(data);
        if (!parsed) return;
        const params = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, stringifyParamValue(v)]),
        );
        if (Object.keys(params).length > 0) {
          console.debug("[iframe-protocol] params update received", params);
          onParamsUpdate?.(params);
        }
      }
    },
    [
      isFromIframe,
      onAiData,
      onParamsUpdate,
      iframeRef,
      bridgeSourceRef,
      bridgeOriginRef,
      pendingRequestsRef,
      postAuth,
    ],
  );

  // Headers that arrive or change after the handshake go to the same page
  useEffect(() => {
    postAuth(bridgeSourceRef.current, bridgeOriginRef.current, authHeaders);
  }, [authHeaders, postAuth]);

  useEffect(() => {
    const ctrl = new AbortController();
    console.debug("[iframe-protocol] listener active, waiting for messages");
    window.addEventListener("message", handleMessage, { signal: ctrl.signal });

    return () => {
      ctrl?.abort();
      bridgeSourceRef.current = null;
      bridgeOriginRef.current = "*";
    };
  }, [handleMessage, bridgeSourceRef, bridgeOriginRef]);

  const requestWidgetData = useCallback(
    (widgetId: string): Promise<WorkspaceDataMessage> => {
      return new Promise((resolve, reject) => {
        // Prefer the stored bridge source (handles nested iframes)
        const target = bridgeSourceRef.current ?? iframeRef.current?.contentWindow;
        if (!target) {
          reject(new Error("Iframe not available"));
          return;
        }

        pendingRequestsRef.current.set(widgetId, { resolve, reject });

        const message: WorkspaceRequestMessage = {
          type: "workspace-request",
          widgetId,
        };
        (target as Window).postMessage(message, bridgeOriginRef.current);

        console.debug("[iframe-protocol] sent workspace-request for:", widgetId);

        setTimeout(() => {
          const pending = pendingRequestsRef.current.get(widgetId);
          if (pending) {
            pendingRequestsRef.current.delete(widgetId);
            pending.reject(new Error(`Request for widget "${widgetId}" timed out`));
          }
        }, REQUEST_TIMEOUT_MS);
      });
    },
    [iframeRef, bridgeSourceRef, bridgeOriginRef, pendingRequestsRef],
  );

  const sendParamsUpdate = useCallback(
    (params: Record<string, string>) => {
      const target = bridgeSourceRef.current ?? iframeRef.current?.contentWindow;
      if (!target) return;

      const message: WorkspaceParamsUpdateMessage = {
        type: "workspace-params-update",
        params,
      };
      (target as Window).postMessage(message, bridgeOriginRef.current);
      console.debug("[iframe-protocol] sent workspace-params-update", params);
    },
    [iframeRef, bridgeSourceRef, bridgeOriginRef],
  );

  return useMemo(
    () => ({
      manifest: state.manifest,
      paramDefs: state.paramDefs,
      requestWidgetData,
      sendParamsUpdate,
    }),
    [state.manifest, state.paramDefs, requestWidgetData, sendParamsUpdate],
  );
}
