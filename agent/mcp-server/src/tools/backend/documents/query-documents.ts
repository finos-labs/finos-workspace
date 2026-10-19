/**
 * `query_documents` MCP tool.
 *
 * Receives:
 *  - `query` — natural-language question
 *  - `doc_ids` (optional) — filter to specific documents
 *  - `top_k` (optional, default 5)
 *  - `x-ines-conversation-id` (decoration) — keys the per-chat store
 *  - `x-ines-documents` (decoration) — delta of newly-uploaded docs
 *    that haven't been ingested yet. The handler extracts → chunks →
 *    embeds → stores them on first sight, then runs retrieval.
 *
 * Returns:
 *  - `text` item with the retrieved chunks formatted as markdown,
 *    each prefixed `[doc_name p.N]` so the model can cite cleanly.
 *  - One `$ines_kind: "citation"` document item per unique doc cited.
 *  - `error` item if no documents are loaded for the conversation.
 */

import { z } from "zod";
import {
  textItem,
  documentCitationItem,
  errorItem,
  type ContentItem,
} from "../../../lib/typed";
import { readAndChunkIsolated } from "./ingest";
import { embedChunks } from "./retrieve";
import { retrieve } from "./retrieve";
import { assertRoom, chargeIngest, ensureHydrated, hasDocument, listDocuments, upsertDocument } from "./store";
import { getLogger } from "../../../lib/logger";
import { scopeSigSchema } from "../../../lib/scope-check";
import { documentBytes, shippedDocumentSchema, type ShippedDocument } from "./payload";

const logger = getLogger(["mcp", "documents", "query"]);

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 12;

export const queryDocumentsSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Natural-language question to search the uploaded documents for. " +
        "The tool returns the top-K most relevant chunks plus citations.",
    ),
  doc_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict the search to specific document ids. Omit to search every uploaded doc in this chat.",
    ),
  top_k: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOP_K)
    .optional()
    .describe(`How many chunks to return (default ${DEFAULT_TOP_K}, max ${MAX_TOP_K}).`),
  "x-ines-conversation-id": z
    .string()
    .optional()
    .describe("INTERNAL — populated by agent decoration. Do not set."),
  "x-ines-scope-sig": scopeSigSchema,
  "x-ines-documents": z
    .array(shippedDocumentSchema)
    .optional()
    .describe("INTERNAL — populated by agent decoration. Do not set."),
};

export const queryDocumentsDescription =
  "Semantic search over documents ALREADY loaded into this conversation's RAG store, by natural-language question. " +
  "Returns the most relevant chunks with citations; filter to a named file via `doc_ids`. " +
  "PRECONDITION: a file widget (tagged [FILE: pdf/docx/txt/md/html]) is NOT in the store until get_widget_data is " +
  "called on it — that single call loads and ingests the file. If the user asks about a file widget you have not " +
  "loaded yet, call get_widget_data on it FIRST, then search here. This tool returns nothing for a file that was never loaded.";

type NewDocPayload = ShippedDocument;

async function ingestDocument(
  conversationId: string,
  payload: NewDocPayload,
): Promise<void> {
  const startedAt = Date.now();
  const bytes = await documentBytes(payload);
  // Read and cut up in a process of its own: a crafted or enormous file cannot stop this server.
  const { chunks, totalChars } = await readAndChunkIsolated({ id: payload.id, format: payload.format, base64: Buffer.from(bytes).toString("base64") });
  // What costs money (the embedding) is done only for what the chat and the user may have.
  assertRoom(conversationId, payload.id, chunks.length);
  chargeIngest(conversationId, chunks.length);
  const embeddings = await embedChunks(chunks);
  await upsertDocument(conversationId, {
    id: payload.id,
    name: payload.name,
    format: payload.format,
    chunks,
    embeddings,
    ingestedAt: Date.now(),
  });
  logger.info("Ingested document", {
    conversationId,
    docId: payload.id,
    name: payload.name,
    chunks: chunks.length,
    chars: totalChars,
    ms: Date.now() - startedAt,
  });
}

async function ingestNewDocs(
  conversationId: string,
  payloads: NewDocPayload[],
): Promise<{ ingested: string[]; errors: string[] }> {
  const ingested: string[] = [];
  const errors: string[] = [];
  for (const p of payloads) {
    if (hasDocument(conversationId, p.id)) {
      logger.debug("Skipping already-ingested doc", {
        conversationId,
        docId: p.id,
      });
      continue;
    }
    try {
      await ingestDocument(conversationId, p);
      ingested.push(p.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to ingest doc ${p.id}: ${msg}`, {
        conversationId,
        docId: p.id,
      });
      errors.push(`${p.name}: ${msg}`);
    }
  }
  return { ingested, errors };
}

function formatRetrievedChunks(
  hits: Awaited<ReturnType<typeof retrieve>>,
): string {
  if (hits.length === 0) return "No matching chunks found.";
  const lines: string[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const pageRef = h.chunk.page != null ? ` p.${h.chunk.page}` : "";
    lines.push(
      `### Hit ${i + 1} — ${h.doc.name}${pageRef} (score=${h.score.toFixed(3)})\n${h.chunk.text}`,
    );
  }
  return lines.join("\n\n---\n\n");
}

export async function queryDocumentsHandler(args: {
  query: string;
  doc_ids?: string[];
  top_k?: number;
  "x-ines-conversation-id"?: string;
  "x-ines-documents"?: NewDocPayload[];
}): Promise<{ content: ContentItem[] }> {
  const conversationId = args["x-ines-conversation-id"];
  const newDocs = args["x-ines-documents"] ?? [];
  const topK = args.top_k ?? DEFAULT_TOP_K;
  const startedAt = Date.now();

  if (!conversationId) {
    logger.warn("query_documents missing conversation id");
    return {
      content: [
        errorItem({
          code: "MISSING_CONVERSATION_ID",
          message:
            "Document query requires a conversation id (X-Trace-Id). Documents cannot be retrieved without it.",
        }),
      ],
    };
  }

  // Pull persisted docs (if any) before reading the in-memory store.
  await ensureHydrated(conversationId);

  // Ingest delta first so the search sees freshly-uploaded docs.
  let ingestErrors: string[] = [];
  if (newDocs.length > 0) {
    const result = await ingestNewDocs(conversationId, newDocs);
    ingestErrors = result.errors;
  }

  // Confirm we actually have something to search.
  const loaded = listDocuments(conversationId);
  if (loaded.length === 0) {
    return {
      content: [
        errorItem({
          code: "NO_DOCUMENTS_LOADED",
          message:
            "No documents are loaded for this conversation." +
            (ingestErrors.length > 0
              ? ` These could not be read: ${ingestErrors.join("; ")}.`
              : " The user must upload one before this tool can answer."),
        }),
      ],
    };
  }

  const hits = await retrieve(conversationId, args.query, {
    topK,
    docIds: args.doc_ids,
  });

  const items: ContentItem[] = [];
  if (ingestErrors.length > 0) {
    items.push(
      textItem(
        `[${ingestErrors.length} document${ingestErrors.length === 1 ? "" : "s"} could not be ingested]\n` +
          ingestErrors.map((e) => `- ${e}`).join("\n"),
      ),
    );
  }
  items.push(textItem(formatRetrievedChunks(hits)));

  // One entry for each page the hits are on, with the best score of the page. Which of them the answer
  // rests on is for the agent to say once it has the answer (it cites the pages the answer names); this
  // tool only reports what it handed to the model. Page is unset for formats without pages: one entry.
  const seen = new Map<string, number>();
  for (const h of hits) {
    const key = `${h.doc.id}\u0000${h.chunk.page ?? ""}`;
    if (seen.has(key)) continue;
    seen.set(key, h.score);
    items.push(
      documentCitationItem({
        id: h.doc.id,
        uri: `ines-doc://${conversationId}/${h.doc.id}`,
        title: h.doc.name,
        ...(h.chunk.page != null ? { page: h.chunk.page } : {}),
        score: h.score,
      }),
    );
  }

  logger.info("query_documents complete", {
    conversationId,
    topK,
    docCount: loaded.length,
    hitCount: hits.length,
    pagesReturned: seen.size,
    totalMs: Date.now() - startedAt,
  });
  return { content: items };
}
