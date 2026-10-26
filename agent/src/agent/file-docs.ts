/**
 * File-tier widget → RAG document bridge.
 *
 * Workspace ships uploaded files as `widgets.primary` entries with widget_id
 * `file-<stored_file_uuid>` and `metadata.extension`. The actual bytes arrive
 * via a normal `get_widget_data` round-trip. When those bytes come back, this
 * helper turns each RAG-eligible file widget into a `PendingDocument` so the
 * loop can ship it to the `query_documents` MCP tool on the next call.
 *
 * Image / CSV / XLSX widgets are NOT routed here — they reach the model via
 * `extractWidgetItems` (vision parts / table rows). Only formats whose value
 * comes from semantic search go through the doc store: pdf, docx, txt, md,
 * html.
 */

import type {
  ToolMessage,
  UploadedDocumentFormat,
  Widget,
} from "../protocol/types.ts";
import type { PendingDocument } from "./documents.ts";
import { MAX_DOC_BYTES } from "./documents.ts";
import { getLogger } from "../lib/logger.ts";

const logger = getLogger(["app", "agent", "file-docs"]);

const RAG_FORMATS: ReadonlySet<UploadedDocumentFormat> = new Set([
  "pdf",
  "docx",
  "txt",
  "md",
  "html",
]);

function detectFormat(
  dataType: string | undefined,
  url: string | undefined,
): UploadedDocumentFormat | null {
  const dt = dataType?.toLowerCase();
  if (dt === "pdf") return "pdf";
  if (dt === "docx") return "docx";
  if (dt === "txt") return "txt";
  if (dt === "md") return "md";
  if (dt === "html" || dt === "htm") return "html";
  if (url) {
    // The link's path, not its query: a signed link ends in the signature.
    let lower = url.toLowerCase();
    try {
      lower = new URL(url).pathname.toLowerCase();
    } catch {
      // not a URL: the whole text is all there is to go by
    }
    if (lower.endsWith(".pdf")) return "pdf";
    if (lower.endsWith(".docx")) return "docx";
    if (lower.endsWith(".txt")) return "txt";
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  }
  return null;
}

/**
 * Scan a `get_widget_data` tool message for file-tier widgets and produce a
 * `PendingDocument` for each one that targets a RAG format: the inline bytes, or
 * the link to the file. Skips oversized inline files and non-RAG formats.
 */
export async function extractFileTierDocs(
  toolMsg: ToolMessage,
  allWidgets: Widget[],
): Promise<PendingDocument[]> {
  const queries =
    (toolMsg.input_arguments?.data_sources as Array<{ widget_uuid: string }>) ??
    [];
  if (!toolMsg.data || toolMsg.data.length === 0) return [];

  const out: PendingDocument[] = [];
  for (let i = 0; i < toolMsg.data.length; i++) {
    const uuid = queries[i]?.widget_uuid;
    if (!uuid) continue;
    const widget = allWidgets.find((w) => w.uuid === uuid);
    if (!widget) continue;
    if (!widget.widget_id.startsWith("file-")) continue;

    for (const rawItem of toolMsg.data[i].items ?? []) {
      const item = rawItem as Record<string, unknown>;
      const dataFormat = item.data_format as Record<string, string> | undefined;
      const url = typeof item.url === "string" ? item.url : undefined;
      const format = detectFormat(dataFormat?.data_type, url);
      if (!format || !RAG_FORMATS.has(format)) continue;

      if (typeof item.content === "string" && item.content) {
        // The file came inline: these are its bytes.
        const bytes = Uint8Array.from(Buffer.from(item.content, "base64"));
        if (bytes.byteLength > MAX_DOC_BYTES) {
          logger.warn(`File-tier doc ${widget.uuid} oversize — skipping`, { bytes: bytes.byteLength });
          continue;
        }
        out.push({ id: widget.uuid!, name: widget.name, format, bytes });
        logger.debug("File-tier doc captured", { widgetUuid: widget.uuid, format, bytes: bytes.byteLength });
      } else if (url) {
        // The file is where the Workspace keeps it: the document search fetches it from there, so neither
        // this process nor the browser that carries the call handles its bytes.
        out.push({ id: widget.uuid!, name: widget.name, format, url });
        logger.debug("File-tier doc referenced", { widgetUuid: widget.uuid, format });
      }
    }
  }
  return out;
}
