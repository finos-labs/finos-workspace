import { z } from "zod";
import { fetchClientUrl } from "../../../../../src/lib/safe-fetch.ts";

const MAX_DOC_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

const DOCUMENT_FORMATS = ["pdf", "docx", "txt", "md", "html"] as const;
type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export interface ShippedDocument {
  id: string;
  name: string;
  format: DocumentFormat;
  content_b64?: string;
  url?: string;
}

const shippedDocumentSchema = z
  .object({
    id: z.string().describe("The id of the document."),
    name: z.string().describe("The file name."),
    format: z.enum(DOCUMENT_FORMATS).describe("The format of the file."),
    content_b64: z.string().optional().describe("The content of the file, in base64. A document has this or url."),
    url: z.string().optional().describe("The signed link of the file. A document has this or content_b64."),
  })
  .refine((doc) => Boolean(doc.content_b64) !== Boolean(doc.url), {
    message: "A document has either content_b64 or url",
  });

export const shippedDocumentsSchema = z
  .array(shippedDocumentSchema)
  .optional()
  .describe("The documents that the agent has not yet sent for this chat. The agent sets it.");

export async function documentBytes(doc: ShippedDocument): Promise<Uint8Array> {
  if (doc.content_b64) return Uint8Array.from(Buffer.from(doc.content_b64, "base64"));
  if (!doc.url) throw new Error("The document has neither bytes nor a link");
  const res = await fetchClientUrl(doc.url, { maxBytes: MAX_DOC_BYTES, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching the file`);
  return new Uint8Array(await res.arrayBuffer());
}
