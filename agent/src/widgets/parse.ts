import type { ImagePart, FilePart } from "ai";
import type { Widget, ToolMessage } from "../protocol/types.ts";
import { getLogger } from "../lib/logger.ts";
import { runInChild } from "../lib/isolate.ts";
import { fetchClientUrl } from "../lib/safe-fetch.ts";
import { assertSafeZip } from "../lib/zip-guard.ts";
import type { XlsxChildInput } from "./xlsx-child.ts";

const logger = getLogger(["app", "widgets"]);

type FileKind = "image" | "pdf" | "docx" | "csv" | "xlsx" | "text";

export function _classifyItem(
  dataFormat?: Record<string, string>,
  url?: string,
): FileKind {
  const dt = dataFormat?.data_type?.toLowerCase();
  if (dt === "jpg" || dt === "jpeg" || dt === "png") return "image";
  if (dt === "pdf") return "pdf";
  if (dt === "docx" || url?.endsWith(".docx")) return "docx";
  if (dt === "csv" || url?.endsWith(".csv")) return "csv";
  if (
    dt === "xlsx" ||
    dt === "xls" ||
    url?.endsWith(".xlsx") ||
    url?.endsWith(".xls")
  )
    return "xlsx";
  return "text";
}

export function _xlsxToJson(buf: ArrayBuffer | Buffer): Promise<string> {
  return xlsxToJson(buf);
}

const XLSX_CHILD = new URL("./xlsx-child.ts", import.meta.url).pathname;
export const XLSX_TIMEOUT_MS = 30_000;
export const URL_DOWNLOAD_TIMEOUT_MS = 30_000;

async function xlsxToJson(buf: ArrayBuffer | Buffer): Promise<string> {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  assertSafeZip(bytes);
  return runInChild<XlsxChildInput, string>(XLSX_CHILD, { base64: bytes.toString("base64") }, { timeoutMs: XLSX_TIMEOUT_MS, label: "xlsx read" });
}

export function _imageMediaType(dt: string): "image/jpeg" | "image/png" {
  if (dt === "png") return "image/png";
  return "image/jpeg";
}

export const MAX_IMAGE_B64_CHARS = 5 * 1024 * 1024;

type MediaPart = ImagePart | FilePart;

export interface WidgetItem {
  name: string;
  uuid: string;
  content: string;
  parts?: MediaPart[];
  documentFormat?: "pdf" | "docx";
  widget?: Widget;
  inputArgs?: Record<string, unknown>;
}

const classifyItem = _classifyItem;
const imageMediaType = _imageMediaType;

export function _csvToJson(csv: string): string {
  return csvToJson(csv);
}

function csvToJson(csv: string): string {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return "[]";

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0].replace(/^﻿/, ""));
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseRow(lines[i]);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const val = values[j] ?? "";
      const num = Number(val);
      row[headers[j]] = val !== "" && !isNaN(num) ? num : val;
    }
    rows.push(row);
  }
  return JSON.stringify(rows);
}

export async function extractWidgetItems(
  toolMsg: ToolMessage,
  allWidgets: Widget[],
): Promise<WidgetItem[]> {
  const items: WidgetItem[] = [];
  const queries =
    (toolMsg.input_arguments?.data_sources as Array<{
      widget_uuid: string;
      input_args?: Record<string, unknown>;
    }>) ?? [];

  logger.debug("extractWidgetItems called", {
    dataLength: toolMsg.data?.length ?? 0,
    queriesLength: queries.length,
  });

  if (!toolMsg.data || toolMsg.data.length === 0) return items;

  for (let i = 0; i < toolMsg.data.length; i++) {
    const uuid = queries[i]?.widget_uuid ?? `unknown_${i}`;
    const widget = allWidgets.find((w) => w.uuid === uuid);
    if (!widget) {
      logger.warn(
        `Widget lookup miss idx=${i} uuid=${uuid} allWidgetsCount=${allWidgets.length} firstUuids=${allWidgets.slice(0, 5).map((w) => w.uuid ?? "(no uuid)").join(",")}`,
        {
          index: i,
          lookupUuid: uuid,
          queriesShape: queries[i] ? Object.keys(queries[i] as Record<string, unknown>) : null,
          allWidgetsCount: allWidgets.length,
          firstWidgetUuids: allWidgets.slice(0, 10).map((w) => w.uuid ?? "(no uuid)"),
        },
      );
    }
    const dataEntry = toolMsg.data[i];
    const rawItems = dataEntry.items ?? [];

    const contentParts: string[] = [];
    const mediaParts: MediaPart[] = [];
    let documentFormat: WidgetItem["documentFormat"];

    for (const item of rawItems) {
      const raw = item as Record<string, unknown>;
      const dataFormat = raw.data_format as Record<string, string> | undefined;
      const url = typeof raw.url === "string" ? raw.url : undefined;
      const kind = classifyItem(dataFormat, url);

      if (typeof raw.content === "string" && raw.content) {
        if (kind === "image") {
          if (raw.content.length > MAX_IMAGE_B64_CHARS) {
            logger.warn("Image too large, skipping", { b64Chars: raw.content.length });
          } else {
            logger.debug("Inline image", { dataType: dataFormat?.data_type });
            mediaParts.push({
              type: "image",
              image: raw.content,
              mediaType: imageMediaType(dataFormat?.data_type ?? ""),
            });
          }
        } else if (kind === "pdf" || kind === "docx") {
          documentFormat = kind;
          logger.debug("Inline document", { format: kind, filename: dataFormat?.filename ?? "unknown" });
        } else if (kind === "xlsx") {
          try {
            const buf = Buffer.from(raw.content, "base64");
            const json = await xlsxToJson(buf);
            contentParts.push(json);
            logger.debug("Inline XLSX converted to JSON", { chars: json.length });
          } catch (e) {
            logger.error("Failed to parse inline XLSX", { error: e });
          }
        } else {
          contentParts.push(raw.content);
        }
      } else if (url) {
        if (kind === "image") {
          logger.debug("Fetching image URL");
          try {
            const res = await fetchClientUrl(url, { signal: AbortSignal.timeout(URL_DOWNLOAD_TIMEOUT_MS) });
            if (res.ok) {
              const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
              if (b64.length > MAX_IMAGE_B64_CHARS) {
                logger.warn("Fetched image too large, skipping", { b64Chars: b64.length });
              } else {
                mediaParts.push({ type: "image", image: b64, mediaType: imageMediaType(dataFormat?.data_type ?? "") });
              }
            }
          } catch (e) {
            logger.error("Failed to fetch image", { url, error: e });
          }
        } else if (kind === "pdf" || kind === "docx") {
          documentFormat = kind;
          logger.debug("Document URL", { format: kind });
        } else if (kind === "xlsx") {
          logger.debug("Fetching XLSX URL", { url: url.slice(0, 80) });
          try {
            const res = await fetchClientUrl(url, { signal: AbortSignal.timeout(URL_DOWNLOAD_TIMEOUT_MS) });
            if (res.ok) {
              const buf = await res.arrayBuffer();
              const json = await xlsxToJson(Buffer.from(buf));
              contentParts.push(json);
              logger.debug("XLSX converted to JSON", { chars: json.length });
            }
          } catch (e) {
            logger.error("Failed to fetch XLSX", { url, error: e });
          }
        } else {
          const isCsv = kind === "csv";
          logger.debug("Fetching data URL", { url: url.slice(0, 80), isCsv });
          try {
            const res = await fetchClientUrl(url, { signal: AbortSignal.timeout(URL_DOWNLOAD_TIMEOUT_MS) });
            if (res.ok) {
              const text = await res.text();
              if (isCsv) {
                const json = csvToJson(text);
                contentParts.push(json);
                logger.debug("CSV converted to JSON", { chars: json.length });
              } else {
                contentParts.push(text);
                logger.debug("Fetched text content", { chars: text.length });
              }
            }
          } catch (e) {
            logger.error("Failed to fetch URL", { url, error: e });
          }
        }
      }
    }

    const content = contentParts.join("\n");
    const hasParts = mediaParts.length > 0;
    if (hasParts || content.trim() || documentFormat) {
      items.push({
        name: widget?.name ?? `widget_${i}`,
        uuid,
        content,
        parts: hasParts ? mediaParts : undefined,
        documentFormat,
        widget: widget ?? undefined,
        inputArgs: queries[i]?.input_args,
      });
    }
  }
  return items;
}
