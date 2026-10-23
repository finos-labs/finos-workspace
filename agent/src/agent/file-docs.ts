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
    let lower = url.toLowerCase();
    try {
      lower = new URL(url).pathname.toLowerCase();
    } catch {
    }
    if (lower.endsWith(".pdf")) return "pdf";
    if (lower.endsWith(".docx")) return "docx";
    if (lower.endsWith(".txt")) return "txt";
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  }
  return null;
}

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
        const bytes = Uint8Array.from(Buffer.from(item.content, "base64"));
        if (bytes.byteLength > MAX_DOC_BYTES) {
          logger.warn(`File-tier doc ${widget.uuid} oversize — skipping`, { bytes: bytes.byteLength });
          continue;
        }
        out.push({ id: widget.uuid!, name: widget.name, format, bytes });
        logger.debug("File-tier doc captured", { widgetUuid: widget.uuid, format, bytes: bytes.byteLength });
      } else if (url) {
        out.push({ id: widget.uuid!, name: widget.name, format, url });
        logger.debug("File-tier doc referenced", { widgetUuid: widget.uuid, format });
      }
    }
  }
  return out;
}
