import DOMPurify from "dompurify";
import { v4 as uuidv4 } from "uuid";
import type { WidgetT } from "~/components/types";
import type { ArtifactT, Citation } from "~/lib/state/copilot";
import { HTML_SANITIZE_CONFIG } from "~/lib/utils/sanitize";
import { removeCitationsFromText } from "./createWidgetUtils";

export const GENERATIVE_WIDGET_DEFAULT_GRID = { x: 0, y: 0, w: 40, h: 12 };

interface BaseWidgetMetadata {
  uuid?: string;
  name: string;
  description?: string;
  citations?: Citation[];
  artifacts?: ArtifactT[];
}

export function buildHtmlWidget(
  content: string,
  metadata: BaseWidgetMetadata,
): WidgetT {
  const { uuid, name, description } = metadata;
  const widgetUuid = uuid || uuidv4();

  const html = DOMPurify.sanitize(content, {
    ...HTML_SANITIZE_CONFIG,
    WHOLE_DOCUMENT: true,
  });

  return {
    id: widgetUuid,
    name,
    description,
    type: "custom",
    widgetId: `html-${widgetUuid}`,
    gridData: { ...GENERATIVE_WIDGET_DEFAULT_GRID, i: widgetUuid },
    storage: { html },
  } as WidgetT;
}

export function buildNoteWidget(
  content: string,
  metadata: BaseWidgetMetadata,
): WidgetT {
  const { uuid, name, description, citations, artifacts } = metadata;
  const widgetUuid = uuid || uuidv4();
  const hasMarkers = Boolean(citations?.length || artifacts?.length);

  return {
    id: widgetUuid,
    name: name ?? "Note",
    description,
    type: "custom",
    widgetId: "markdown",
    gridData: { ...GENERATIVE_WIDGET_DEFAULT_GRID, i: widgetUuid },
    storage: {
      text: hasMarkers ? content : removeCitationsFromText(content),
      citations: citations ?? [],
      artifacts: artifacts ?? [],
    },
  } as WidgetT;
}
