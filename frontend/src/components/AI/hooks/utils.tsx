import isEqual from "lodash.isequal";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import type { WidgetT } from "~/components/types";
import { docsUrl } from "~/lib/docsUrl";
import type {
  Citation,
  Copilot,
  CopilotFile,
  WidgetSignature,
} from "~/lib/state/copilot";
import type { DashboardWidgetData } from "~/lib/state/copilotData";
import { isTruthyRecord } from "~/lib/utils/values";
import { createURLString, currentDateModifier } from "~/lib/utils/widgetParams";
import type { CreateWidgetParams } from "./useCreateWidgetFromArtifact";
import type { CopilotSubmitParams } from "./useStreamResponse";

/**
 * The citations of an AI message as the backend sends them, with the id and signature
 * they miss filled in. What cannot be rendered, as it names no source, is dropped.
 */
export function normalizeCitations(citations: unknown): Citation[] {
  if (!Array.isArray(citations)) return [];
  return citations.flatMap((raw): Citation[] => {
    if (!(isTruthyRecord(raw) && isTruthyRecord(raw.source_info))) return [];
    const c = raw as Partial<Citation> & Pick<Citation, "source_info">;
    if (c.id && c.signature !== undefined) return [c as Citation];
    return [
      {
        id: c.id || uuidv4(),
        signature: c.signature || "",
        source_info: c.source_info,
        details: c.details,
        artifacts: c.artifacts,
        quote_bounding_boxes: c.quote_bounding_boxes,
      },
    ];
  });
}

/**
 * Dispatches an event update Copilot question
 */
export async function dispatchCopilotCommand(
  command: string | ((prev: string) => string),
) {
  return window.dispatchEvent(
    new CustomEvent("copilotCommand", {
      detail: { command },
    }),
  );
}

/**
 * Uploaded files travel with the message they were attached to, failed ones stay
 * in the composer so the user can see the error, and a pending upload blocks the send.
 */
export function partitionFilesOnSend(files: CopilotFile[]) {
  const sent: CopilotFile[] = [];
  let hasPending = false;

  for (const file of files) {
    if (file.status === "uploaded") sent.push(file);
    else if (file.status === "pending") hasPending = true;
  }

  return { sent, hasPending };
}

export function dispatchCreate(detail: CreateWidgetParams) {
  return window.dispatchEvent(
    new CustomEvent("createWidgetPopup", {
      detail,
    }),
  );
}

export function getWidgetOrigin(widget: WidgetT): string {
  // TODO: We should have an explicit field for this

  if (widget.connectionType === "file") return "the backend";
  if (widget.external) return widget.sourceName ?? "Unknown";
  return "Workspace";
}

export const showDeprecatedFlagsToast = (copilot: Copilot, outdatedFlags: string[]) => {
  const agentsDocsHref = docsUrl(
    "workspace/developers/json-specs/agents-json-reference",
  );
  toast.warning("Outdated copilots.json or agents.json detected", {
    description: (
      <>
        Deprecated config flags detected for '{copilot.name}':{" "}
        {outdatedFlags.join(", ")}.
        {agentsDocsHref && (
          <>
            {" "}
            Check the{" "}
            <a
              href={agentsDocsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-primary-500 hover:text-primary-600"
            >
              documentation
            </a>{" "}
            for the latest schema.
          </>
        )}
      </>
    ),
  });
};

export function dispatchExpandCopilotIfHidden() {
  return window.dispatchEvent(new CustomEvent("expandCopilotIfHidden"));
}

export function dispatchCollapseCopilotPanel() {
  return window.dispatchEvent(new CustomEvent("collapseCopilot"));
}

export async function dispatchCopilotSubmit(props?: CopilotSubmitParams) {
  const { question, addHumanMessage, mockResponse } = props || {};

  return window.dispatchEvent(
    new CustomEvent("copilotSubmit", {
      detail: { question, addHumanMessage, mockResponse },
    }),
  );
}

export function normalizeWidgetId(
  widgetId: string | undefined,
  origin?: string,
): string | undefined {
  return widgetId?.replace(`${origin}-`, "");
}

/** Resolves an agent's endpoints against the base URL of the holder that registered it. */
export function resolveAgentEndpoints(
  endpoints: Copilot["endpoints"],
  baseUrl: string,
): Copilot["endpoints"] {
  const resolved = { ...endpoints };
  for (const key of ["upload_docs", "query", "feedback"] as const) {
    const value = resolved[key];
    if (value) resolved[key] = createURLString(value, baseUrl);
  }
  return resolved;
}

// Helper function to normalize argument values for comparison
function normalizeArgValue(value: unknown): unknown {
  // Convert single-element arrays to their first element for comparison
  // This handles the case where backend sends ["UNRATE"] but widget has "UNRATE"
  if (Array.isArray(value) && value.length === 1) {
    value = value[0];
  }

  // Normalize string numbers to numbers for comparison
  // This handles cases where one source has "20" and another has 20
  if (typeof value === "string" && !Number.isNaN(Number(value)) && value !== "") {
    // Check if it's a pure number (not something like "20abc")
    const numValue = Number(value);
    if (numValue.toString() === value.trim()) {
      return numValue;
    }
  }

  return value;
}

// Compare args with normalization
function compareNormalizedArgs(
  args1: Record<string, unknown> | undefined,
  args2: Record<string, unknown> | undefined,
): boolean {
  if (!(args1 || args2)) return true;
  if (!(args1 && args2)) return false;

  // Only compare keys that exist in args2 (the citation signature)
  // This means we only check if the citation's specified params match
  // We don't care about extra params in the widget that aren't in the citation
  for (const key of Object.keys(args2)) {
    const val1 = normalizeArgValue(args1[key]);
    const val2 = normalizeArgValue(args2[key]);

    // If widget doesn't have this param but citation specifies it, no match
    if (val1 === undefined || val1 === null) {
      if (val2 !== undefined && val2 !== null) {
        return false;
      }
      continue;
    }

    if (!isEqual(val1, val2)) {
      return false;
    }
  }

  return true;
}

export function compareSignatures(
  sig1: WidgetSignature | undefined,
  sig2: WidgetSignature | undefined,
): boolean {
  if (!(sig1 && sig2)) return false;

  const normalizedWidgetId1 = normalizeWidgetId(sig1.widgetId, sig1.origin);
  const normalizedWidgetId2 = normalizeWidgetId(sig2.widgetId, sig2.origin);
  const originMatch = sig1.origin === sig2.origin;
  const widgetIdMatch = normalizedWidgetId1 === normalizedWidgetId2;
  const argsMatch = compareNormalizedArgs(sig1.args, sig2.args);

  return originMatch && widgetIdMatch && argsMatch;
}

export function createSignatureMap(
  widgetsInCurrentDashboard: WidgetT[],
  dashboardWidgetsData: Record<string, DashboardWidgetData>,
) {
  return widgetsInCurrentDashboard.reduce(
    (acc, widget) => {
      const storedParams = dashboardWidgetsData?.[widget.id]?.metadata?.params;
      const widgetParams: Record<string, unknown> =
        typeof storedParams === "object" && storedParams !== null
          ? (storedParams as Record<string, unknown>)
          : {};
      const currentParams = (widget.params ?? []).reduce<Record<string, unknown>>(
        (paramAcc, param) => {
          // Check for params in multiple places:
          // 1. dashboardWidgetsData (when widget has been used with AI)
          // 2. widget.storage.params (actual stored params)
          // 3. param.value (default value)
          const paramValue =
            widgetParams?.[param.paramName] ??
            widget.storage?.params?.[param.paramName] ??
            param.value;
          paramAcc[param.paramName] =
            param.type === "date" && typeof paramValue === "string"
              ? currentDateModifier(paramValue)
              : paramValue;
          return paramAcc;
        },
        {},
      );

      const origin = getWidgetOrigin(widget);
      const normalizedWidgetId = normalizeWidgetId(widget.widgetId, origin);
      acc[widget.id] = {
        origin: origin,
        widgetId:
          (origin === "Workspace" ? widget.id : normalizedWidgetId) ?? "Unknown",
        args: currentParams,
      };
      return acc;
    },
    {} as Record<string, WidgetSignature>,
  );
}

/** Returns true when a citation carries a SQL query that differs from the matched widget's query. */
export function detectQueryMismatch(
  citationQuery: unknown,
  widgetQuery: unknown,
): boolean {
  return !!(citationQuery && widgetQuery && citationQuery !== widgetQuery);
}
