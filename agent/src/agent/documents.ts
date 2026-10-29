import type { UploadedDocument } from "../protocol/types.ts";
import { getLogger } from "../lib/logger.ts";
import { fetchClientUrl } from "../lib/safe-fetch.ts";

const logger = getLogger(["app", "agent", "documents"]);

const URL_FETCH_TIMEOUT_MS = 30_000;
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

export interface PendingDocument {
  id: string;
  name: string;
  format: UploadedDocument["format"];
  bytes?: Uint8Array;
  url?: string;
}

export type ShippedDocument = { id: string; name: string; format: UploadedDocument["format"] } & (
  | { content_b64: string; url?: undefined }
  | { url: string; content_b64?: undefined }
);

export async function loadUploadedDocuments(
  documents: UploadedDocument[] | undefined,
): Promise<Map<string, PendingDocument>> {
  const out = new Map<string, PendingDocument>();
  if (!documents || documents.length === 0) return out;

  for (const doc of documents) {
    try {
      const bytes = await readBytes(doc);
      if (bytes.byteLength > MAX_DOC_BYTES) {
        logger.warn(`Document ${doc.id} exceeds ${MAX_DOC_BYTES} bytes — skipping`, {
          docId: doc.id,
          size: bytes.byteLength,
        });
        continue;
      }
      out.set(doc.id, {
        id: doc.id,
        name: doc.name,
        format: doc.format,
        bytes,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to load document ${doc.id}: ${msg}`, { docId: doc.id });
    }
  }
  logger.info(`Loaded ${out.size} of ${documents.length} documents`, {
    requested: documents.length,
    loaded: out.size,
  });
  return out;
}

async function readBytes(doc: UploadedDocument): Promise<Uint8Array> {
  if (doc.content_b64) {
    return Uint8Array.from(Buffer.from(doc.content_b64, "base64"));
  }
  if (doc.url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
    try {
      const res = await fetchClientUrl(doc.url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${doc.url}`);
      }
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Document ${doc.id} has neither content_b64 nor url`);
}

export function buildDocumentsDecoration(
  pending: Map<string, PendingDocument>,
  shippedIds: Set<string>,
): ShippedDocument[] | null {
  const delta: ShippedDocument[] = [];
  for (const doc of pending.values()) {
    if (shippedIds.has(doc.id)) continue;
    const { id, name, format } = doc;
    if (doc.url) delta.push({ id, name, format, url: doc.url });
    else if (doc.bytes) delta.push({ id, name, format, content_b64: Buffer.from(doc.bytes).toString("base64") });
  }
  return delta.length > 0 ? delta : null;
}
