import type {
  WorkspaceDataMessage,
  WorkspaceWidgetManifest,
} from "~/types/iframeProtocol";

export type IframeWidgetEntry = {
  requestWidgetData: (widgetId: string) => Promise<WorkspaceDataMessage>;
  sendRefresh: () => void;
  manifest: WorkspaceWidgetManifest[];
};

const registry = new Map<string, IframeWidgetEntry>();

export function registerIframeWidget(
  parentUuid: string,
  entry: IframeWidgetEntry,
): void {
  registry.set(parentUuid, entry);
}

export function unregisterIframeWidget(parentUuid: string): void {
  registry.delete(parentUuid);
}

export function getIframeWidget(parentUuid: string): IframeWidgetEntry | undefined {
  return registry.get(parentUuid);
}
