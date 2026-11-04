import { getLogger } from "../lib/logger.ts";

const logger = getLogger(["app", "agent", "context"]);

export const CONTEXT_TEXT_BLOCK_MAX_CHARS = 8_000;

function capText(text: string): string {
  if (text.length <= CONTEXT_TEXT_BLOCK_MAX_CHARS) return text;
  return `${text.slice(0, CONTEXT_TEXT_BLOCK_MAX_CHARS)}\n[…truncated, original ${text.length} chars]`;
}

interface ContextTable {
  name: string;
  rows: Record<string, unknown>[];
}

interface ContextTextBlock {
  name: string;
  description?: string;
  text: string;
}

interface SplitContext {
  tables: ContextTable[];
  textBlocks: ContextTextBlock[];
}

function sanitizeTableName(raw: string, idx: number): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned ? `ctx_${cleaned}` : `ctx_${idx}`;
}

function looksLikeRows(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null &&
    !Array.isArray(value[0])
  );
}

export function splitContext(items: unknown): SplitContext {
  const out: SplitContext = { tables: [], textBlocks: [] };
  if (!Array.isArray(items)) return out;

  let tableIdx = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : "context";
    const description =
      typeof item.description === "string" ? item.description : undefined;
    const data = item.data as
      | { items?: Array<{ content?: string; data_format?: { parse_as?: string } }> }
      | undefined;
    const dataItems = data?.items ?? [];

    if (dataItems.length === 0) {
      const text = description?.trim();
      if (text) out.textBlocks.push({ name, description, text: capText(text) });
      continue;
    }

    for (const di of dataItems) {
      const content = di.content;
      if (typeof content !== "string" || !content.trim()) continue;
      const parseAs = di.data_format?.parse_as;

      let pushedAsTable = false;
      if (parseAs === "table" || parseAs === undefined) {
        try {
          const parsed = JSON.parse(content) as unknown;
          if (looksLikeRows(parsed)) {
            out.tables.push({
              name: sanitizeTableName(name, tableIdx++),
              rows: parsed,
            });
            pushedAsTable = true;
          }
        } catch {
        }
      }
      if (!pushedAsTable) {
        out.textBlocks.push({ name, description, text: capText(content) });
      }
    }
  }

  if (out.tables.length > 0 || out.textBlocks.length > 0) {
    logger.info("Split request.context", {
      tables: out.tables.length,
      textBlocks: out.textBlocks.length,
    });
  }
  return out;
}
