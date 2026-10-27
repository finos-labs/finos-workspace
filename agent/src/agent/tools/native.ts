import type { ToolSet } from "ai";
import type { SSEEvent } from "../../protocol/types.ts";
import type { TableInfo } from "../../sql/loader.ts";
import { makeEnhancePromptTool } from "./enhance-prompt.ts";
import { makeLlmThinkTool } from "./think.ts";
import { makeTableFromTextTool } from "./table-from-text.ts";
import { makeHtmlArtifactTool } from "./html-artifact.ts";

const NATIVE_TOOL_NAMES = [
  "enhance_prompt",
  "_llm_think",
  "create_table_from_text",
  "create_html_artifact",
  "create_app",
  "suggest_followups",
  "recall_conversation",
  "load_tools",
] as const;

export const NATIVE_TOOL_NAME_SET: ReadonlySet<string> = new Set(NATIVE_TOOL_NAMES);

interface NativeToolsContext {
  pendingTables: Map<string, Record<string, unknown>[]>;
  artifactQueue: SSEEvent[];
  tables: TableInfo[];
  conversationId: string;
}

export function makeNativeTools(ctx: NativeToolsContext): ToolSet {
  return {
    enhance_prompt: makeEnhancePromptTool(),
    _llm_think: makeLlmThinkTool({ artifactQueue: ctx.artifactQueue }),
    create_table_from_text: makeTableFromTextTool({
      pendingTables: ctx.pendingTables,
      artifactQueue: ctx.artifactQueue,
      tables: ctx.tables,
      conversationId: ctx.conversationId,
    }),
    create_html_artifact: makeHtmlArtifactTool({
      artifactQueue: ctx.artifactQueue,
    }),
  };
}
