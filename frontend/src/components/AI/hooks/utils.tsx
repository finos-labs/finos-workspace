import isEqual from "lodash.isequal";
import { v4 as uuidv4 } from "uuid";
import type { WidgetT } from "~/components/types";
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

const citedWidget = ({ source_info }: Citation) =>
  source_info.type === "widget"
    ? (source_info.uuid ?? source_info.widget_id ?? null)
    : null;

export function withoutCitedWidgets(existing: Citation[], incoming: Citation[]) {
  const ids = new Set(existing.map((citation) => citation.id));
  const widgets = new Set(
    existing.map(citedWidget).filter((widget) => widget !== null),
  );
  return incoming.filter((citation) => {
    const widget = citedWidget(citation);
    if (ids.has(citation.id) || (widget !== null && widgets.has(widget))) return false;
    ids.add(citation.id);
    if (widget !== null) widgets.add(widget);
    return true;
  });
}

export async function dispatchCopilotCommand(
  command: string | ((prev: string) => string),
) {
  return window.dispatchEvent(
    new CustomEvent("copilotCommand", {
      detail: { command },
    }),
  );
}

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
  if (widget.connectionType === "file") return "the backend";
  if (widget.external) return widget.sourceName ?? "Unknown";
  return "Workspace";
}

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

function normalizeArgValue(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) {
    value = value[0];
  }

  if (typeof value === "string" && !Number.isNaN(Number(value)) && value !== "") {
    const numValue = Number(value);
    if (numValue.toString() === value.trim()) {
      return numValue;
    }
  }

  return value;
}

function compareNormalizedArgs(
  args1: Record<string, unknown> | undefined,
  args2: Record<string, unknown> | undefined,
): boolean {
  if (!(args1 || args2)) return true;
  if (!(args1 && args2)) return false;

  for (const key of Object.keys(args2)) {
    const val1 = normalizeArgValue(args1[key]);
    const val2 = normalizeArgValue(args2[key]);

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

export function detectQueryMismatch(
  citationQuery: unknown,
  widgetQuery: unknown,
): boolean {
  return !!(citationQuery && widgetQuery && citationQuery !== widgetQuery);
}
