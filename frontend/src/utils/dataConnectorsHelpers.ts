import type { WidgetT } from "~/components/types";
import {
  type StoredFile,
  useBackendConnectorStore,
  type WidgetMetadataItem,
} from "~/lib/state/backendConnector";
import { processWidgetId } from "~/lib/utils";

type WidgetMetadataT = WidgetMetadataItem | StoredFile;
export function handleWidgetMetadata<T extends WidgetMetadataT>(
  widget: WidgetT,
): T | undefined {
  const widgetInfo = processWidgetId(widget.widgetId ?? "", widget.connectionType);

  const { getStoredFileById, getWidgetMetadataById } =
    useBackendConnectorStore.getState();

  if (widget.connectionType === "file") {
    return getStoredFileById(widgetInfo.uuid) as T;
  }
  return getWidgetMetadataById(widgetInfo.uuid) as T;
}
