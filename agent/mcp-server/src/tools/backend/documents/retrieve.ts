import { embed, embedMany, cosineSimilarity, type EmbeddingModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOllama } from "ollama-ai-provider-v2";
import type { DocChunk } from "./chunk.ts";
import { iterChunks, type StoredDocument } from "./store.ts";
import { getLogger } from "../../../lib/logger.ts";

const logger = getLogger(["mcp", "documents", "retrieve"]);

type EmbedKind = "query" | "passage";

const EMBED_BATCH_SIZE = 256;

function withInputType(kind: EmbedKind): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return fetch(input, {
      ...init,
      body: JSON.stringify({ ...body, input_type: kind, truncate: "END" }),
    });
  }) as typeof fetch;
}

interface EmbeddingProvider {
  keyEnv?: string;
  model: (modelId: string, kind: EmbedKind, apiKey: string) => EmbeddingModel;
}

const EMBEDDING_PROVIDERS: Record<string, EmbeddingProvider> = {
  openai: {
    keyEnv: "OPENAI_API_KEY",
    model: (id, _kind, apiKey) => createOpenAI({ apiKey }).textEmbeddingModel(id),
  },
  openrouter: {
    keyEnv: "OPENROUTER_API_KEY",
    model: (id, _kind, apiKey) => createOpenRouter({ apiKey }).textEmbeddingModel(id),
  },
  nvidia: {
    keyEnv: "NVIDIA_API_KEY",
    model: (id, kind, apiKey) =>
      createOpenAI({
        apiKey,
        baseURL: "https://integrate.api.nvidia.com/v1",
        fetch: withInputType(kind),
      }).textEmbeddingModel(id),
  },
  ollama: {
    model: (id) =>
      createOllama({ baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/api" }).textEmbeddingModel(id),
  },
};

function splitModelId(raw: string): { provider: string; modelId: string } | null {
  const colon = raw.indexOf(":");
  if (colon <= 0 || colon === raw.length - 1) return null;
  return { provider: raw.slice(0, colon), modelId: raw.slice(colon + 1) };
}

export function embeddingProblem(): string | null {
  const raw = process.env.INES_EMBED_MODEL;
  if (!raw) return "INES_EMBED_MODEL is not set: document search needs an embedding model, written <provider>:<model>.";
  const parsed = splitModelId(raw);
  const provider = parsed && EMBEDDING_PROVIDERS[parsed.provider];
  if (!parsed || !provider) {
    return `INES_EMBED_MODEL "${raw}" must be <provider>:<model> with a provider that embeds (${Object.keys(EMBEDDING_PROVIDERS).join(", ")}).`;
  }
  if (provider.keyEnv && !process.env[provider.keyEnv]) {
    return `INES_EMBED_MODEL names ${parsed.provider}, which needs ${provider.keyEnv}.`;
  }
  return null;
}

const _embedModels: Partial<Record<EmbedKind, EmbeddingModel>> = {};

export function getEmbeddingModel(kind: EmbedKind): EmbeddingModel {
  const memoized = _embedModels[kind];
  if (memoized) return memoized;
  const problem = embeddingProblem();
  if (problem) throw new Error(problem);
  const { provider, modelId } = splitModelId(process.env.INES_EMBED_MODEL!)!;
  const { keyEnv, model } = EMBEDDING_PROVIDERS[provider];
  return (_embedModels[kind] = model(modelId, kind, keyEnv ? process.env[keyEnv]! : ""));
}

export function _resetEmbeddingModel(): void {
  delete _embedModels.query;
  delete _embedModels.passage;
}

export function _setEmbeddingModelForTest(model: EmbeddingModel): void {
  _embedModels.query = model;
  _embedModels.passage = model;
}

export async function embedChunks(chunks: DocChunk[]): Promise<number[][]> {
  if (chunks.length === 0) return [];
  const model = getEmbeddingModel("passage");
  const startedAt = Date.now();
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = await embedMany({
      model,
      values: chunks.slice(i, i + EMBED_BATCH_SIZE).map((c) => c.text),
    });
    embeddings.push(...batch.embeddings);
  }
  logger.info("Embedded chunks", {
    count: chunks.length,
    ms: Date.now() - startedAt,
    dim: embeddings[0]?.length ?? 0,
  });
  return embeddings;
}

export interface RetrievedChunk {
  chunk: DocChunk;
  doc: StoredDocument;
  score: number;
}

export async function retrieve(
  conversationId: string,
  query: string,
  options: { topK: number; docIds?: string[] },
): Promise<RetrievedChunk[]> {
  const model = getEmbeddingModel("query");
  const startedAt = Date.now();
  const { embedding: queryVec } = await embed({ model, value: query });
  const idFilter = options.docIds && options.docIds.length > 0
    ? new Set(options.docIds)
    : null;

  const scored: RetrievedChunk[] = [];
  for (const { chunk, doc, embedding } of iterChunks(conversationId)) {
    if (idFilter && !idFilter.has(doc.id)) continue;
    const score = cosineSimilarity(queryVec, embedding);
    scored.push({ chunk, doc, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, options.topK);
  logger.info("Retrieved", {
    conversationId,
    query: query.slice(0, 80),
    candidates: scored.length,
    returned: top.length,
    topScore: top[0]?.score ?? null,
    ms: Date.now() - startedAt,
  });
  return top;
}
