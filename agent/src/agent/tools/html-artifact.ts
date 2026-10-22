/**
 * `create_html_artifact` — emit a workspace HTML artifact rendered in a
 * sandboxed iframe (`Artifact.tsx:119`). Use for one-off inline reports the
 * model assembles from text + table data; do NOT use as a substitute for a
 * proper table/chart artifact.
 *
 * State-bound — closes over `artifactQueue` and validates the payload before
 * pushing. Size cap mirrors Ada's `llm_create_html_artifact` (50 KB).
 */

import { tool } from "ai";
import { z } from "zod";
import { messageArtifact } from "../../protocol/events.ts";
import type { HtmlArtifact, SSEEvent } from "../../protocol/types.ts";
import { getLogger } from "../../lib/logger.ts";

const logger = getLogger(["app", "tools", "html_artifact"]);

const MAX_HTML_BYTES = 50 * 1024;

export const htmlArtifactSchema = z.object({
  html: z
    .string()
    .min(1)
    .describe(
      "Inline HTML for the artifact. Everything must be in the HTML: inline styles, and images as `data:` URIs. " +
        "The chat loads nothing from the network (an image, style, font, script or frame given by address is not shown) " +
        "and runs no script. Max 50 KB.",
    ),
  name: z.string().min(1).describe("Short artifact name, shown in the citation chip."),
  description: z
    .string()
    .min(1)
    .describe("One-line description of what the HTML renders."),
});

export const htmlArtifactDescription =
  "Render a one-off HTML report or layout in the workspace conversation. " +
  "Use sparingly — prefer a table or chart artifact when the data is structured. " +
  "For flowcharts or other diagrams, use a diagram tool if one is listed; otherwise draw them here. " +
  "Workspace renders the HTML in a sandboxed iframe that may load nothing by address and runs no script.";

export type HtmlArtifactArgs = z.infer<typeof htmlArtifactSchema>;

export interface HtmlArtifactContext {
  artifactQueue: SSEEvent[];
}

export function runHtmlArtifact(
  args: HtmlArtifactArgs,
  ctx: HtmlArtifactContext,
): string {
  const bytes = Buffer.byteLength(args.html, "utf-8");
  if (bytes > MAX_HTML_BYTES) {
    return `Error: HTML too large (${bytes} bytes > ${MAX_HTML_BYTES} byte cap).`;
  }
  const artifact: HtmlArtifact = {
    type: "html",
    uuid: crypto.randomUUID(),
    name: args.name,
    description: args.description,
    content: args.html,
  };
  ctx.artifactQueue.push(messageArtifact(artifact));
  logger.info("create_html_artifact emitted", {
    name: args.name,
    bytes,
  });
  return `Created HTML artifact "${args.name}". It is now rendered in the workspace.`;
}

export function makeHtmlArtifactTool(ctx: HtmlArtifactContext) {
  return tool({
    description: htmlArtifactDescription,
    inputSchema: htmlArtifactSchema,
    execute: async (args) => runHtmlArtifact(args as HtmlArtifactArgs, ctx),
  });
}
