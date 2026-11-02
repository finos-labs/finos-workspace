import cloneDeep from "lodash/cloneDeep";
import { useMemo } from "react";
import {
  deleteApiSource,
  deleteFileWidget,
  deleteWidgetMetadata,
  getApiSources,
  getFileWidgets,
} from "~/api/auth.api";
import {
  deleteSourceWidgets,
  getCleanedCategory,
} from "~/components/DataConnectors/common/helpers";
import type { WidgetJsonT, WidgetT } from "~/components/types";
import { useWidgetContext } from "~/components/Widget.context";
import type { WidgetId } from "~/components/Widgets";
import { getFileWidgetType } from "~/lib/constants";
import type { BackendConnectorStore, Source } from "~/lib/state/backendConnector";
import { useBackendConnectorStore } from "~/lib/state/backendConnector";
import { isRenderableVizType } from "~/lib/types/app";
import { createURLString } from "~/lib/utils";
import { streamEndpointOf } from "~/lib/utils/widgetParams";
import WIDGETS from "~/lib/widgets.json";
import { getPluginVizTypes } from "~/plugins/registry";
import type { WidgetType } from "~/utils/zodForms";
import type { Widget } from "../state/app";
import {
  CopilotDataItemSchema,
  type CopilotError,
  type DataContent,
  type DataUrl,
} from "../state/copilot";

export const CORE_WIDGET_IDS = ["navigation_bar", "iframe", "html"];

// biome-ignore format: off
export type WidgetsIds = Extract<keyof typeof WIDGETS, string> | `${string}-${number | string}`;

const WIDGET_CATALOG = WIDGETS as unknown as Record<string, WidgetJsonT>;

export function getCatalogWidget(
  widgetId: string | undefined,
): WidgetJsonT | undefined {
  return widgetId ? WIDGET_CATALOG[widgetId] : undefined;
}

export function getJsonWidget(widget: WidgetId | Partial<Widget>): WidgetT | null {
  if (typeof widget === "string") {
    const catalogWidget = WIDGET_CATALOG[widget];
    if (!catalogWidget) return null;
    widget = catalogWidget as Partial<Widget>;
  }
  const { id, widgetId } = widget;
  const fromCatalog = widgetId ? WIDGET_CATALOG[widgetId] : undefined;
  return cloneDeep({ ...(fromCatalog ?? widget), id, widgetId } as WidgetT);
}

export function getWidgetSourceInfo(widget: Widget | null) {
  const widgetSource = getWidgetDataSource(widget as WidgetT);

  let sourceName = widget?.sourceName || widgetSource || widget?.source || "";

  if (Array.isArray(sourceName)) sourceName = sourceName.join(", ");
  const source = Array.isArray(widgetSource) ? widgetSource.join(", ") : widgetSource;

  return { source, sourceName };
}

export function getWidgetInfo(widget: Partial<WidgetT | WidgetType>) {
  const { type, name, description, category, subCategory, source } = widget;
  return { type, name, description, category, subCategory, source };
}

export function getWidgetDataSource(widget: Partial<WidgetT> | null): string[] {
  if (!widget) return [];

  const widgetFromJSON = getJsonWidget(widget);

  const source = (widget.external ? widget.source : widgetFromJSON?.source) ?? [];

  return (Array.isArray(source) ? source : [source]).filter(Boolean);
}

export function useWidgetDataSource(): string[] {
  const widgetFromJSON = useWidgetContext()?.widgetFromJSON ?? null;

  return useMemo(() => getWidgetDataSource(widgetFromJSON), [widgetFromJSON]);
}

export function extractColumns(data: unknown): string[] | null {
  if (!(data && Array.isArray(data)) || data.length === 0) {
    return null;
  }

  const firstRow = data[0];
  if (typeof firstRow !== "object" || firstRow === null || Array.isArray(firstRow)) {
    return null;
  }

  const columns = Object.keys(firstRow);
  return columns.length > 0 ? columns : null;
}

export const WIDGETS_WITHOUT_DISABLED = Object.values(WIDGET_CATALOG).reduce<
  WidgetJsonT[]
>((acc, value) => {
  if (value && !value.disabled) {
    value.external = false;
    acc.push(value);
  }
  return acc;
}, []);

export function convertAdvancedBackend(source: Source): WidgetT[] {
  const widgets = source.widgets ?? {};
  const pluginTypes = getPluginVizTypes();
  return Object.keys(widgets).flatMap((widgetId) => {
    const widget = widgets[widgetId];
    if (!isRenderableVizType(widget.type, pluginTypes)) return [];
    const streamEndpoint = streamEndpointOf(widget.data, source.url);
    const newWidget = {
      ...cloneDeep({ ...widget }),
      type: widget.type,
      endpoint: {
        url: createURLString(widget.endpoint, source.url),
        method: widget.method ?? "GET",
      },
      ...(streamEndpoint ? { data: { ...widget.data, streamEndpoint } } : {}),
      external: true,
      widgetType: "backend",
      sourceId: source.id,
      sourceName: source.name,
      category: getCleanedCategory(widget?.category),
      connectionType: "advanced-backend",
    } as unknown as WidgetT;

    return [newWidget];
  });
}

export const WIDGETS_CONNECTION_TYPES = [
  "individual" as const,
  "backend" as const,
  "file" as const,
  "widgetMetadata" as const,
];
export type WidgetConnectionTypes = (typeof WIDGETS_CONNECTION_TYPES)[number];

export function getAllWidgets(
  ignoreSourceId?: string,
  connectionTypes: WidgetConnectionTypes[] = WIDGETS_CONNECTION_TYPES,
): WidgetT[] {
  const { apiSources, storedFiles, widgetMetadata } =
    useBackendConnectorStore.getState();
  const result: WidgetT[] = [];

  if (connectionTypes.includes("widgetMetadata")) {
    result.push(
      ...widgetMetadata.map(
        (widget) =>
          ({
            ...cloneDeep({ ...widget }),
            connectionType: "widgetMetadata",
            type: widget.widgetType,
            widgetId: `${widget.widgetType}-${widget.widgetId}`,
            category: getCleanedCategory(widget?.category),
            subCategory: widget?.subCategory,
            storage: {
              ...(widget.storage ?? {}),
            },
          }) as unknown as WidgetT,
      ),
    );
  }

  if (connectionTypes.includes("individual")) {
    result.push(
      ...WIDGETS_WITHOUT_DISABLED.map(
        (widget) => cloneDeep({ ...widget }) as unknown as WidgetT,
      ),
    );
  }
  if (connectionTypes.includes("backend")) {
    result.push(
      ...apiSources
        .filter(
          (elem) => elem.id !== "root" && elem.widgets && elem.id !== ignoreSourceId,
        )
        .flatMap((source) => {
          return convertAdvancedBackend(source);
        }),
    );
  }
  if (connectionTypes.includes("file")) {
    result.push(
      ...storedFiles.map((widget) => {
        return {
          ...cloneDeep({ ...widget }),
          type: getFileWidgetType(widget.extension),
          external: true,
          category: widget?.category ?? "My Data",
          subCategory:
            widget?.subCategory ?? (widget as { sub_category?: string }).sub_category,
          widgetType: "file",
          endpoint: widget.url,
          widgetId: `file-${widget.id}`,
          description: widget.description,
          connectionType: "file",
          gridData: { w: 20, h: widget.extension === "pdf" ? 20 : 10 },
          extension: widget.extension,
          data: { dataKey: widget?.dataKey },
        } as unknown as WidgetT;
      }),
    );
  }
  return cloneDeep([...result]);
}

export function getCleanWidgetId(
  widgetId: string,
  connectionType?: WidgetT["connectionType"],
) {
  if (connectionType === "advanced-backend" || connectionType === "plugin")
    return widgetId;
  return widgetId
    ?.replace(/^shared_file-.*/, "file")
    ?.replace(/^file-.*/, "file")
    ?.replace(/^iframe-.*/, "iframe")
    ?.replace(/^html-.*/, "html");
}

const WIDGET_ID_CLEANING = ["iframe-", "shared_file-", "file-", "html-"];

const WIDGET_ID_CLEANING_REGEX = new RegExp(`^(${WIDGET_ID_CLEANING.join("|")})`);

export function getUUIDFromWidgetId(widgetId: string) {
  return widgetId.replace(WIDGET_ID_CLEANING_REGEX, "");
}

export function processWidgetId(
  widgetId: string,
  connectionType?: WidgetT["connectionType"],
): {
  uuid: string;
  cleanWidgetId: string;
} {
  const uuid = getUUIDFromWidgetId(widgetId);
  const cleanWidgetId = getCleanWidgetId(widgetId, connectionType);

  return {
    uuid,
    cleanWidgetId,
  };
}

export const METADATA_WIDGETS = ["websites", "website", "html"];

export async function handleWidgetDeletion({
  type,
  id,
  backendConnector,
  deleteWidgets,
}: {
  type: string;
  id: string;
  backendConnector: Pick<
    BackendConnectorStore,
    "updateApiSources" | "setStoredFiles" | "setWidgetMetadata"
  >;
  deleteWidgets: (id: string) => void;
}) {
  if (type === "backend") {
    const { apiSources } = useBackendConnectorStore.getState();
    const source = apiSources.find((source) => source.id === id);

    if (source) deleteSourceWidgets(source);

    await deleteApiSource(id);
    const result = await getApiSources();
    return await backendConnector.updateApiSources(result);
  }
  if (type === "file") {
    await deleteFileWidget(id);
    const result = await getFileWidgets();
    backendConnector.setStoredFiles(result);
    return deleteWidgets(`file-${id}`);
  }

  if (METADATA_WIDGETS.includes(type)) {
    deleteWidgets(`${type}-${id}`);
    const result = await deleteWidgetMetadata(id);
    return backendConnector.setWidgetMetadata(result);
  }

  throw new Error("Invalid widget type");
}

export interface FileResponse {
  aiData: Partial<DataContent | DataUrl | CopilotError>;
  objectUrl: string;
}

export async function handleFileResponse(
  response: Response,
  options?: {
    filename?: string;
    defaultUrl?: string;
  },
): Promise<FileResponse> {
  const contentType = response.headers.get("Content-Type");

  if (contentType === "application/json") {
    const json = await response.json();
    const parsedResponse = CopilotDataItemSchema.parse(json);
    if (
      "data_format" in parsedResponse &&
      parsedResponse.data_format?.data_type === "pdf"
    ) {
      if ("content" in parsedResponse && parsedResponse.content) {
        const byteArray = base64ToUint8Array(parsedResponse.content);
        return {
          aiData: parsedResponse,
          objectUrl: URL.createObjectURL(
            new Blob([byteArray], { type: "application/pdf" }),
          ),
        };
      }

      if ("url" in parsedResponse && parsedResponse.url) {
        const blob = await fetch(parsedResponse.url).then((res) => res.blob());
        return {
          aiData: parsedResponse,
          objectUrl: URL.createObjectURL(blob),
        };
      }
      throw new Error("Invalid data");
    }
  }
  if (contentType === "application/pdf") {
    const blob = await response.blob();
    return {
      aiData: {
        url: options?.defaultUrl ?? "",
        data_format: { data_type: "pdf", filename: options?.filename },
      },
      objectUrl: URL.createObjectURL(blob),
    };
  }
  throw new Error("Invalid content type");
}

function base64ToUint8Array(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}
