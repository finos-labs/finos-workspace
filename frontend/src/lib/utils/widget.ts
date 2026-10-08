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
import { createURLString } from "~/lib/utils";
import WIDGETS from "~/lib/widgets.json";
import type { WidgetType } from "~/utils/zodForms";
import type { Widget } from "../state/app";
import {
  CopilotDataItemSchema,
  type CopilotError,
  type DataContent,
  type DataUrl,
  MultipleCopilotDataItemSchema,
} from "../state/copilot";
import { isExcludedWidgetId } from "../state/featureFlags";

/** The built-in widgets every entity can add (the widget search shows them under "All"). */
export const CORE_WIDGET_IDS = ["navigation_bar", "iframe", "html"];

// biome-ignore format: off
export type WidgetsIds = Extract<keyof typeof WIDGETS, string> | `${string}-${number | string}`;

/** The built-in widget catalog (`lib/widgets.json`), keyed by widget id. */
const WIDGET_CATALOG = WIDGETS as unknown as Record<string, WidgetJsonT>;

/** A widget of the built-in catalog (`lib/widgets.json`), if there is one with this id. */
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

export function getSupportedAssetClasses(
  widgetId: WidgetsIds | string | undefined,
): string[] {
  return cloneDeep((widgetId && WIDGET_CATALOG[widgetId]?.supportedAssetClasses) || []);
}

export function getWidgetsWithSupportedAssetClass(
  assetClass: string,
  onlyIds: true,
): WidgetJsonT["widgetId"][];
export function getWidgetsWithSupportedAssetClass(
  assetClass: string,
  onlyIds?: false,
): WidgetJsonT[];
export function getWidgetsWithSupportedAssetClass(assetClass: string, onlyIds = false) {
  return cloneDeep(
    Object.values(WIDGET_CATALOG)
      .filter((widget) => widget?.supportedAssetClasses?.includes(assetClass))
      .map((widget) => (onlyIds ? widget.widgetId : widget)),
  );
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
  const mainTicker = useWidgetContext()?.widget?.data?.mainTicker;
  const widgetFromJSON = useWidgetContext()?.widgetFromJSON;

  const widgetDataSource = useMemo(() => {
    const widget = {
      ...widgetFromJSON,
      data: { ...widgetFromJSON?.data, mainTicker },
    };
    return getWidgetDataSource(widget);
  }, [widgetFromJSON?.widgetId, mainTicker?.exchange]);

  return widgetDataSource;
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

export function getAdvancedBackendChildren(id: string): string[] {
  const apiSources = useBackendConnectorStore.getState()?.apiSources ?? [];
  const filtered = apiSources.find((source) => source.id === id);
  return Object.values(filtered?.widgets ?? {})
    .map((item) => item.widgetId)
    .filter((widgetId): widgetId is string => widgetId !== undefined);
}

export function convertAdvancedBackend(source: Source): WidgetT[] {
  const widgets = source.widgets ?? {};
  return Object.keys(widgets).map((widgetId) => {
    const widget = widgets[widgetId];
    const newWidget = {
      ...cloneDeep({ ...widget }),
      type: widget.type ?? widget.defaultViz,
      endpoint: createURLString(widget.endpoint, source.url),
      external: true,
      widgetType: "backend",
      sourceId: source.id,
      sourceName: source.name,
      category: getCleanedCategory(widget?.category),
      connectionType: "advanced-backend",
    } as unknown as WidgetT;

    return newWidget;
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
      // Built-in widgets that the entity's data bundle does not exclude
      ...WIDGETS_WITHOUT_DISABLED.filter(
        (widget) => !isExcludedWidgetId(widget.widgetId),
      ).map((widget) => cloneDeep({ ...widget }) as unknown as WidgetT),
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

/**
 * Converts widgetId to clean widgetId because some widgetIds have the widgetId as suffix and then the uuid
 * e.g., files will have file- as prefix so they will be file-uuid
 * iframe saved to backend will have iframe- as prefix so they will be iframe-uuid
 * This function removes the prefix and returns the cleaned widgetId
 * @param widgetId
 */
export function getCleanWidgetId(
  widgetId: string,
  connectionType?: WidgetT["connectionType"],
) {
  if (connectionType === "advanced-backend") return widgetId;
  return widgetId
    ?.replace(/shared_file-.*/, "file")
    ?.replace(/file-.*/, "file")
    ?.replace(/iframe-.*/, "iframe")
    ?.replace(/html-.*/, "html");
}

const WIDGET_ID_CLEANING = ["iframe-", "shared_file-", "file-", "html-"];

const WIDGET_ID_CLEANING_REGEX = new RegExp(`^(${WIDGET_ID_CLEANING.join("|")})`);

/**
 * Removes the prefix from the widgetId, i.e., if widgetId is file-uuid, it will return uuid
 * @param widgetId
 * @returns widgetId without the prefix
 */
export function getUUIDFromWidgetId(widgetId: string) {
  return widgetId.replace(WIDGET_ID_CLEANING_REGEX, "");
}

/**
 * Processes a widgetId to extract both the UUID and the clean widget ID.
 * @param widgetId - The original widget ID to process.
 * @returns An object containing the UUID and clean widget ID.
 */
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

/**
 * Handles the deletion of a widget based on its type and ID.
 * @param type - The type of widget to delete
 * @param id - The ID of the widget
 * @param parent - Optional parent flag for database types
 * @param backendConnector - The backend connector store instance
 * @param deleteWidgets - Function to delete widgets
 * @param deleteWidgetsConnection - Function to delete widget connections
 * @param setDatabases - Function to set databases
 */
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

export async function handleMultiFileResponse(
  filenames: string[],
  response: Response,
): Promise<Record<string, FileResponse>> {
  const contentType = response.headers.get("Content-Type");

  if (contentType === "application/json") {
    const json = await response.json();
    const parsedResponse = MultipleCopilotDataItemSchema.parse(json);
    if (filenames.length !== parsedResponse.length) {
      throw new Error(
        `Expected ${filenames.length} items, but got ${parsedResponse.length}`,
      );
    }
    const entries = await Promise.all(
      filenames.map(async (filename, index) => {
        const item = parsedResponse[index];
        let fileResponse: FileResponse | null = null;
        if ("data_format" in item && item.data_format?.data_type === "pdf") {
          // Base64 encoded PDF
          if ("content" in item && item.content) {
            const byteArray = base64ToUint8Array(item.content);
            fileResponse = {
              aiData: item,
              objectUrl: URL.createObjectURL(
                new Blob([byteArray], { type: "application/pdf" }),
              ),
            };
          } else if ("url" in item && item.url) {
            const blob = await fetch(item.url).then((res) => res.blob());
            fileResponse = {
              aiData: item,
              objectUrl: URL.createObjectURL(blob),
            };
          }
        } else if ("error_type" in item) {
          fileResponse = {
            aiData: item,
            objectUrl: "",
          };
        }

        return [filename, fileResponse];
      }),
    );

    return Object.fromEntries(entries);
  }
  throw new Error("Invalid content type, expected application/json");
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
      // Base64 encoded PDF
      if ("content" in parsedResponse && parsedResponse.content) {
        const byteArray = base64ToUint8Array(parsedResponse.content);
        return {
          aiData: parsedResponse,
          objectUrl: URL.createObjectURL(
            new Blob([byteArray], { type: "application/pdf" }),
          ),
        };
      }

      // URL to PDF
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
  // PDF file blob
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
  // Create a buffer directly from the decoded base64 string
  // This approach avoids potential ArrayBuffer detachment issues
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}
