/**
 * Per-conversation document store for the ines-tools MCP server.
 *
 * Lifecycle:
 *  - `query_documents` decoration ships uploaded docs once per conversation.
 *    We extract → chunk → embed → store, keyed by conversationId + docId.
 *  - Subsequent calls in the same chat read from the store directly.
 *  - TTL eviction (30 min idle) matches how long the agent keeps a chat's
 *    rows, so a chat that idles past that will re-ship anyway. Process restart
 *    drops the store entirely (no persistence).
 *
 * Memory cap: per-conversation `MAX_DOCS_PER_CHAT` and `MAX_CHUNKS_PER_CHAT`
 * fail loud on overflow so a runaway upload can't OOM the MCP server.
 *
 * `_resetDocStoreState()` test hook clears everything.
 */

import type { DocChunk } from "./chunk";
import type { UploadedDocumentFormat } from "../../../../../src/protocol/types";
import { createBoundedCache } from "../../../../../src/lib/bounded-cache";
import { userOfScope } from "../../../../../src/lib/scope";
import { getLogger } from "../../../lib/logger";
import { getRedisClient } from "../../../lib/redis";
import { MAX_CHUNKS_PER_DOC } from "./limits";

const logger = getLogger(["mcp", "documents", "store"]);

export const TTL_MS = 30 * 60 * 1000;
export const MAX_DOCS_PER_CHAT = 50;
export const MAX_CHUNKS_PER_CHAT = 5000;
/** Most chats whose documents are held at once, and most chunks of all of them: the least recently used go first. */
export const MAX_STORES = 300;
export const MAX_TOTAL_CHUNKS = 120_000;
const REDIS_TTL_S = 48 * 3600;

/**
 * How many chunks one user may have read and embedded in an hour (INES_INGEST_CHUNKS_PER_HOUR, default 20,000).
 * Embedding is paid for with the operator's key: without a ceiling per user, anybody could run it up by
 * uploading documents in chat after chat.
 */
export function ingestChunksPerHour(): number {
  const configured = Number(process.env.INES_INGEST_CHUNKS_PER_HOUR);
  return Number.isFinite(configured) && configured > 0 ? configured : 20_000;
}
const ingestUsed = createBoundedCache<string, { chunks: number }>({ ttlMs: 60 * 60 * 1000, maxEntries: 20_000 });

function redisKey(conversationId: string): string {
  return `ines:doc:${conversationId}`;
}

export interface StoredDocument {
  id: string;
  name: string;
  format: UploadedDocumentFormat;
  /** Chunk text + metadata. */
  chunks: DocChunk[];
  /**
   * Aligned 1:1 with `chunks` — embedding vector for chunk[i] at index i.
   * Stored separately so retrieval can do a single matrix-shaped scan.
   */
  embeddings: number[][];
  ingestedAt: number;
}

interface DocStore {
  conversationId: string;
  docs: Map<string, StoredDocument>;
  lastTouched: number;
  /** True once we've tried to hydrate this conversation from Redis. */
  hydrated: boolean;
}

const stores = new Map<string, DocStore>();

// A Map keeps insertion order: a store that is used is moved to the end, so the first is the least recently used.
function touch(s: DocStore): void {
  s.lastTouched = Date.now();
  if (stores.get(s.conversationId) === s) {
    stores.delete(s.conversationId);
    stores.set(s.conversationId, s);
  }
}

function totalChunks(): number {
  let n = 0;
  for (const s of stores.values()) for (const d of s.docs.values()) n += d.chunks.length;
  return n;
}

/** Drops the stores used longest ago while there are too many of them, or they hold too much. */
function enforceGlobalBounds(keep: string): void {
  let chunks = totalChunks();
  for (const [key, s] of stores) {
    if (stores.size <= MAX_STORES && chunks <= MAX_TOTAL_CHUNKS) break;
    if (key === keep) continue;
    stores.delete(key);
    for (const d of s.docs.values()) chunks -= d.chunks.length;
    logger.info("Evicted a doc store to stay within bounds", { conversationId: key });
  }
}

/**
 * Throws when a document of `chunks` passages cannot be added to the chat: it has too many documents or
 * passages already. Called before the document is embedded, so that nothing is paid for what will be refused.
 */
export function assertRoom(conversationId: string, docId: string, chunks: number): void {
  if (chunks > MAX_CHUNKS_PER_DOC) {
    throw new Error(`it is too long to search: ${chunks} passages, and the most for one document is ${MAX_CHUNKS_PER_DOC}`);
  }
  const s = stores.get(conversationId);
  if (!s) return;
  if (!s.docs.has(docId) && s.docs.size >= MAX_DOCS_PER_CHAT) {
    throw new Error(`this chat already holds ${MAX_DOCS_PER_CHAT} documents, the most there can be`);
  }
  const would = [...s.docs.values()].reduce((n, d) => n + d.chunks.length, 0) + chunks - (s.docs.get(docId)?.chunks.length ?? 0);
  if (would > MAX_CHUNKS_PER_CHAT) {
    throw new Error(`this chat's documents would be ${would} passages, and the most there can be is ${MAX_CHUNKS_PER_CHAT}`);
  }
}

/** Counts `chunks` against the user the scope key names; throws when they have used their hour's share. */
export function chargeIngest(conversationId: string, chunks: number): void {
  const user = userOfScope(conversationId);
  const used = ingestUsed.get(user)?.chunks ?? 0;
  if (used + chunks > ingestChunksPerHour()) {
    throw new Error("you have reached the limit on documents read in the last hour: try again later");
  }
  // (Set again, not mutated: a write is what gives the count its hour.)
  const entry = ingestUsed.get(user) ?? { chunks: 0 };
  entry.chunks = used + chunks;
  if (!ingestUsed.has(user)) ingestUsed.set(user, entry);
}

function evictExpired(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, s] of stores) {
    if (s.lastTouched < cutoff) {
      stores.delete(k);
      logger.debug("Evicted expired doc store", { conversationId: k });
    }
  }
}

export function getStore(conversationId: string): DocStore {
  evictExpired();
  let s = stores.get(conversationId);
  if (!s) {
    s = {
      conversationId,
      docs: new Map(),
      lastTouched: Date.now(),
      hydrated: false,
    };
    stores.set(conversationId, s);
    enforceGlobalBounds(conversationId);
  } else {
    touch(s);
  }
  return s;
}

/**
 * Pull any persisted docs for this conversation from Redis into the in-memory
 * store. No-op when Redis isn't configured or the conversation has already
 * been hydrated this process lifetime. Safe to call repeatedly.
 */
export async function ensureHydrated(conversationId: string): Promise<void> {
  const s = getStore(conversationId);
  if (s.hydrated) return;
  s.hydrated = true;
  const redis = getRedisClient();
  if (!redis) return;
  try {
    const all = await redis.hgetall(redisKey(conversationId));
    let loaded = 0;
    for (const [docId, json] of Object.entries(all)) {
      if (s.docs.has(docId)) continue;
      try {
        const doc = JSON.parse(json) as StoredDocument;
        s.docs.set(docId, doc);
        loaded += 1;
      } catch (err) {
        logger.warn(`Failed to parse hydrated doc ${docId}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (loaded > 0) {
      logger.info("Hydrated docs from Redis", { conversationId, count: loaded });
    }
  } catch (err) {
    logger.warn(`Redis hydrate failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function upsertDocument(
  conversationId: string,
  doc: StoredDocument,
): Promise<void> {
  const s = getStore(conversationId);
  // Cheap guard — concurrent upserts for the same id are fine, just
  // overwrite. Across distinct ids enforce caps.
  if (!s.docs.has(doc.id) && s.docs.size >= MAX_DOCS_PER_CHAT) {
    throw new Error(
      `Document cap (${MAX_DOCS_PER_CHAT}) reached for conversation ${conversationId}`,
    );
  }
  const totalChunks =
    [...s.docs.values()].reduce((acc, d) => acc + d.chunks.length, 0) +
    doc.chunks.length -
    (s.docs.get(doc.id)?.chunks.length ?? 0);
  if (totalChunks > MAX_CHUNKS_PER_CHAT) {
    throw new Error(
      `Chunk cap (${MAX_CHUNKS_PER_CHAT}) reached for conversation ${conversationId} (would be ${totalChunks})`,
    );
  }
  s.docs.set(doc.id, doc);
  touch(s);
  enforceGlobalBounds(conversationId);
  logger.debug("Stored document", {
    conversationId,
    docId: doc.id,
    chunks: doc.chunks.length,
  });

  const redis = getRedisClient();
  if (redis) {
    try {
      const key = redisKey(conversationId);
      await redis.hset(key, doc.id, JSON.stringify(doc));
      await redis.expire(key, REDIS_TTL_S);
    } catch (err) {
      logger.warn(`Redis upsert failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

export function listDocuments(conversationId: string): StoredDocument[] {
  const s = stores.get(conversationId);
  if (!s) return [];
  touch(s);
  return [...s.docs.values()];
}

export function hasDocument(conversationId: string, docId: string): boolean {
  return stores.get(conversationId)?.docs.has(docId) ?? false;
}

/**
 * Iterate all (chunk, doc, embedding) triples for retrieval. Caller filters
 * by `docIds` if needed; pushing the filter here would require yet another
 * Map and the chat-scope set is tiny anyway.
 */
export function* iterChunks(
  conversationId: string,
): Generator<{ chunk: DocChunk; doc: StoredDocument; embedding: number[] }> {
  const s = stores.get(conversationId);
  if (!s) return;
  touch(s);
  for (const doc of s.docs.values()) {
    for (let i = 0; i < doc.chunks.length; i++) {
      yield { chunk: doc.chunks[i], doc, embedding: doc.embeddings[i] };
    }
  }
}

/** Test-only: clear all module state. */
export function _resetDocStoreState(): void {
  stores.clear();
  ingestUsed.clear();
}
