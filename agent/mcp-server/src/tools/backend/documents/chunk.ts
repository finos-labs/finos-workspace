import { encode } from "gpt-tokenizer";
import type { ExtractedPage } from "./extract.ts";
import { MAX_CHUNK_CHARS } from "./limits.ts";

export interface DocChunk {
  id: string;
  docId: string;
  index: number;
  page?: number;
  text: string;
  tokens: number;
}

interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
  maxTokens?: number;
}

const DEFAULT_TARGET = 500;
const DEFAULT_OVERLAP = 50;
const DEFAULT_MAX = 800;

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9])|\n{2,}/;

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .flatMap((s) => (s.length > MAX_CHUNK_CHARS ? hardSplit(s, MAX_CHUNK_CHARS) : [s]));
}

function hardSplit(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let at = 0; at < text.length; at += size) parts.push(text.slice(at, at + size));
  return parts;
}

function tokensOf(text: string): number {
  return encode(text).length;
}

function chunkOnePage(
  pageText: string,
  page: number | undefined,
  docId: string,
  startIndex: number,
  opts: Required<ChunkOptions>,
): DocChunk[] {
  if (!pageText.trim()) return [];
  const sentences = splitSentences(pageText);
  if (sentences.length === 0) return [];

  const chunks: DocChunk[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  let chunkIdx = startIndex;

  const flush = (): void => {
    if (buf.length === 0) return;
    const text = buf.join(" ").trim();
    if (!text) {
      buf = [];
      bufTokens = 0;
      return;
    }
    chunks.push({
      id: `${docId}:${chunkIdx}`,
      docId,
      index: chunkIdx,
      ...(page != null ? { page } : {}),
      text,
      tokens: tokensOf(text),
    });
    chunkIdx++;
    if (opts.overlapTokens > 0 && buf.length > 1) {
      const tail: string[] = [];
      let tailTokens = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        const sTokens = tokensOf(buf[i]);
        if (tailTokens + sTokens > opts.overlapTokens) break;
        tail.unshift(buf[i]);
        tailTokens += sTokens;
      }
      buf = tail;
      bufTokens = tailTokens;
    } else {
      buf = [];
      bufTokens = 0;
    }
  };

  for (const sentence of sentences) {
    const sTokens = tokensOf(sentence);
    if (sTokens > opts.maxTokens) {
      flush();
      chunks.push({
        id: `${docId}:${chunkIdx}`,
        docId,
        index: chunkIdx,
        ...(page != null ? { page } : {}),
        text: sentence,
        tokens: sTokens,
      });
      chunkIdx++;
      continue;
    }
    if (bufTokens + sTokens > opts.targetTokens && buf.length > 0) {
      flush();
    }
    buf.push(sentence);
    bufTokens += sTokens;
    if (bufTokens >= opts.maxTokens) flush();
  }
  flush();
  return chunks;
}

export function chunkDocument(
  docId: string,
  pages: ExtractedPage[],
  options?: ChunkOptions,
): DocChunk[] {
  const opts: Required<ChunkOptions> = {
    targetTokens: options?.targetTokens ?? DEFAULT_TARGET,
    overlapTokens: options?.overlapTokens ?? DEFAULT_OVERLAP,
    maxTokens: options?.maxTokens ?? DEFAULT_MAX,
  };
  const all: DocChunk[] = [];
  for (const p of pages) {
    const pageChunks = chunkOnePage(p.text, p.page, docId, all.length, opts);
    all.push(...pageChunks);
  }
  return all;
}
