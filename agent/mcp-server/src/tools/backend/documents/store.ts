import type { DocChunk } from "./chunk.ts";
import type { UploadedDocumentFormat } from "../../../../../src/protocol/types.ts";
import { createBoundedCache } from "../../../../../src/lib/bounded-cache.ts";
import { userOfScope } from "../../../../../src/lib/scope.ts";
import { getLogger } from "../../../lib/logger.ts";
import { getRedisClient } from "../../../lib/redis.ts";
import { MAX_CHUNKS_PER_DOC } from "./limits.ts";

const logger = getLogger(["mcp", "documents", "store"]);

export const TTL_MS = 30 * 60 * 1000;
export const MAX_DOCS_PER_CHAT = 50;
export const MAX_CHUNKS_PER_CHAT = 5000;
export const MAX_STORES = 300;
export const MAX_TOTAL_CHUNKS = 120_000;
const REDIS_TTL_S = 48 * 3600;

export function ingestChunksPerHour(): number {
  const configured = Number(process.env.AGENT_INGEST_CHUNKS_PER_HOUR);
  return Number.isFinite(configured) && configured > 0 ? configured : 20_000;
}
const ingestUsed = createBoundedCache<string, { chunks: number }>({ ttlMs: 60 * 60 * 1000, maxEntries: 20_000 });

function redisKey(conversationId: string): string {
  return `agent:doc:${conversationId}`;
}

export interface StoredDocument {
  id: string;
  name: string;
  format: UploadedDocumentFormat;
  chunks: DocChunk[];
  embeddings: number[][];
  ingestedAt: number;
}

interface DocStore {
  conversationId: string;
  docs: Map<string, StoredDocument>;
  lastTouched: number;
  hydrated: boolean;
}

const stores = new Map<string, DocStore>();

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

export function chargeIngest(conversationId: string, chunks: number): void {
  const user = userOfScope(conversationId);
  const used = ingestUsed.get(user)?.chunks ?? 0;
  if (used + chunks > ingestChunksPerHour()) {
    throw new Error("you have reached the limit on documents read in the last hour: try again later");
  }
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

export function _resetDocStoreState(): void {
  stores.clear();
  ingestUsed.clear();
}
