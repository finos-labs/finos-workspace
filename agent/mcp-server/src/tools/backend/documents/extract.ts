import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import * as cheerio from "cheerio";
import type { UploadedDocumentFormat } from "../../../../../src/protocol/types.ts";
import { assertSafeZip } from "../../../../../src/lib/zip-guard.ts";
import { getLogger } from "../../../lib/logger.ts";
import { MAX_EXTRACTED_CHARS, MAX_PDF_PAGES } from "./limits.ts";

const logger = getLogger(["mcp", "documents", "extract"]);

export interface ExtractedPage {
  page?: number;
  text: string;
}

interface ExtractResult {
  pages: ExtractedPage[];
  totalChars: number;
}

export async function extractDocument(
  format: UploadedDocumentFormat,
  bytes: Uint8Array,
): Promise<ExtractResult> {
  const result = await extractByFormat(format, bytes);
  if (result.totalChars > MAX_EXTRACTED_CHARS) {
    throw new Error(`The document has ${result.totalChars} characters of text: the most that is read is ${MAX_EXTRACTED_CHARS}.`);
  }
  return result;
}

async function extractByFormat(
  format: UploadedDocumentFormat,
  bytes: Uint8Array,
): Promise<ExtractResult> {
  switch (format) {
    case "pdf":
      return extractPdf(bytes);
    case "docx":
      return extractDocx(bytes);
    case "html":
      return extractHtml(bytes);
    case "txt":
    case "md":
      return extractText_(bytes);
    default: {
      const exhaustive: never = format;
      throw new Error(`Unsupported document format: ${exhaustive as string}`);
    }
  }
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new Error(`The PDF has ${pdf.numPages} pages: the most that is read is ${MAX_PDF_PAGES}.`);
  }
  const result = await extractText(pdf, { mergePages: false });
  const pageTexts = Array.isArray(result.text) ? result.text : [result.text];
  const pages: ExtractedPage[] = pageTexts.map((text, idx) => ({
    page: idx + 1,
    text: text ?? "",
  }));
  const totalChars = pages.reduce((acc, p) => acc + p.text.length, 0);
  logger.debug("PDF extracted", { pages: pages.length, totalChars });
  return { pages, totalChars };
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractResult> {
  assertSafeZip(bytes);
  const buf = Buffer.from(bytes);
  const result = await mammoth.extractRawText({ buffer: buf });
  const text = result.value;
  logger.debug("DOCX extracted", { totalChars: text.length });
  return { pages: [{ text }], totalChars: text.length };
}

function extractHtml(bytes: Uint8Array): ExtractResult {
  const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const text =
    $("body").text().trim() || $.root().text().trim();
  logger.debug("HTML extracted", { totalChars: text.length });
  return { pages: [{ text }], totalChars: text.length };
}

function extractText_(bytes: Uint8Array): ExtractResult {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return { pages: [{ text }], totalChars: text.length };
}
