/**
 * The child process that reads a document and cuts it into chunks (see lib/isolate.ts in the agent): a crafted
 * file, or one that is just very large, cannot stop the tool server or exhaust its memory.
 */

import { serveOnce } from "../../../../../src/lib/isolate-child";
import { chunkDocument, type DocChunk } from "./chunk";
import { extractDocument } from "./extract";
import { MAX_CHUNKS_PER_DOC } from "./limits";
import type { UploadedDocumentFormat } from "../../../../../src/protocol/types";

export interface IngestChildInput {
  id: string;
  format: UploadedDocumentFormat;
  base64: string;
}

export interface IngestChildOutput {
  chunks: DocChunk[];
  totalChars: number;
}

export async function readAndChunk(input: IngestChildInput): Promise<IngestChildOutput> {
  const extracted = await extractDocument(input.format, Uint8Array.from(Buffer.from(input.base64, "base64")));
  if (extracted.totalChars === 0) {
    throw new Error("it has no text to search (a scanned document is only pictures of text)");
  }
  const chunks = chunkDocument(input.id, extracted.pages);
  if (chunks.length > MAX_CHUNKS_PER_DOC) {
    throw new Error(`it is too long to search: ${chunks.length} passages, and the most for one document is ${MAX_CHUNKS_PER_DOC}`);
  }
  return { chunks, totalChars: extracted.totalChars };
}

if (import.meta.main) await serveOnce(readAndChunk);
