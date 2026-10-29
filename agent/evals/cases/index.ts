import { widgetSelectionCases } from "./widget-selection.ts";
import { sqlAnalysisCases } from "./sql-analysis.ts";
import { intentCases } from "./intent.ts";
import { workspaceContextCases } from "./workspace-context.ts";
import { toolRoutingCases } from "./tool-routing.ts";
import { localeCases } from "./locale.ts";
import { citationsCases } from "./citations.ts";
import { fileWidgetCases } from "./file-widgets.ts";
import { skillsCases } from "./skills.ts";
import { nativeToolsCases } from "./native-tools.ts";
import { appBuilderCases } from "./app-builder.ts";
import { mcpRoutingCases } from "./mcp-routing.ts";
import { urlContextCases } from "./url-context.ts";
import { streamingCases } from "./streaming.ts";
import type { EvalCase } from "../runner.ts";

export const ALL_CASES: EvalCase[] = [
  ...widgetSelectionCases,
  ...intentCases,
  ...workspaceContextCases,
  ...toolRoutingCases,
  ...sqlAnalysisCases,
  ...localeCases,
  ...citationsCases,
  ...fileWidgetCases,
  ...skillsCases,
  ...nativeToolsCases,
  ...appBuilderCases,
  ...mcpRoutingCases,
  ...urlContextCases,
  ...streamingCases,
];

export const CASE_GROUPS = {
  "widget-selection": widgetSelectionCases,
  intent: intentCases,
  "workspace-context": workspaceContextCases,
  "tool-routing": toolRoutingCases,
  "sql-analysis": sqlAnalysisCases,
  locale: localeCases,
  citations: citationsCases,
  "file-widgets": fileWidgetCases,
  skills: skillsCases,
  "native-tools": nativeToolsCases,
  "app-builder": appBuilderCases,
  "mcp-routing": mcpRoutingCases,
  "url-context": urlContextCases,
  streaming: streamingCases,
} as const;
