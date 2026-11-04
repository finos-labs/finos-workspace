import type { Item } from "~/lib/state/app";
import type { Source } from "~/lib/state/backendConnector";
import type { AppArtifactT, AppArtifactWidgetRef } from "~/lib/state/copilot";

export function buildWidgetSourceResolver(
  widgetRefs: AppArtifactWidgetRef[],
  apiSources: Source[],
): (widgetId: string) => Source | undefined {
  const byWidgetId = new Map<string, Source>();

  for (const ref of widgetRefs) {
    if (byWidgetId.has(ref.widget_id)) continue;

    const match =
      apiSources.find(
        (source) =>
          source.name === ref.origin && Boolean(source.widgets?.[ref.widget_id]),
      ) ?? apiSources.find((source) => Boolean(source.widgets?.[ref.widget_id]));

    if (match) byWidgetId.set(ref.widget_id, match);
  }

  return (widgetId) => byWidgetId.get(widgetId);
}

export function buildAppArtifactSource(artifact: AppArtifactT): Source {
  return {
    id: artifact.uuid,
    uuid: artifact.uuid,
    name: "Agent App",
    url: "",
    endpointHeaders: null,
  };
}

export function shouldAutoOpenAppArtifact({
  currentDashboardItem,
}: {
  currentDashboardItem: Item | null | undefined;
}): boolean {
  return (
    !!currentDashboardItem?.data &&
    !currentDashboardItem.isFolder &&
    currentDashboardItem.data.widgets?.length === 0
  );
}
