/**
 * What one document, one chat and one user may cost the document search: a crafted or enormous file is
 * refused with a reason, nothing is paid for it, and the server goes on.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MockEmbeddingModelV3 } from "ai/test";
import { queryDocumentsHandler } from "../../../../../../mcp-server/src/tools/backend/documents/query-documents";
import { _resetEmbeddingModel, _setEmbeddingModelForTest } from "../../../../../../mcp-server/src/tools/backend/documents/retrieve";
import {
  _resetDocStoreState,
  listDocuments,
  MAX_DOCS_PER_CHAT,
  MAX_STORES,
  MAX_TOTAL_CHUNKS,
  upsertDocument,
  type StoredDocument,
} from "../../../../../../mcp-server/src/tools/backend/documents/store";
import { chunkDocument } from "../../../../../../mcp-server/src/tools/backend/documents/chunk";
import { MAX_CHUNK_CHARS, MAX_EXTRACTED_CHARS, MAX_PDF_PAGES } from "../../../../../../mcp-server/src/tools/backend/documents/limits";
import { makePdf } from "../../../../../helpers/make-pdf";
import { makeZip } from "../../../../../helpers/make-zip";

let embedCalls = 0;
let embeddedValues = 0;
// What was embedded: the question of a search is one; the text of a document is the rest.
let embeddedTexts: string[] = [];

beforeEach(() => {
  _resetDocStoreState();
  embedCalls = 0;
  embeddedValues = 0;
  embeddedTexts = [];
  _setEmbeddingModelForTest(
    new MockEmbeddingModelV3({
      doEmbed: async ({ values }) => {
        embedCalls++;
        embeddedValues += values.length;
        embeddedTexts.push(...values);
        return { embeddings: values.map(() => [1, 0, 0, 0]), warnings: [] };
      },
    }),
  );
});
afterEach(() => {
  _resetEmbeddingModel();
  delete process.env.INES_INGEST_CHUNKS_PER_HOUR;
});

const b64 = (bytes: Uint8Array | string) => Buffer.from(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes).toString("base64");
const ingest = (conversation: string, doc: { id: string; name: string; format: "pdf" | "docx" | "txt"; bytes: Uint8Array | string }) =>
  queryDocumentsHandler({
    query: "anything",
    "x-ines-conversation-id": conversation,
    "x-ines-documents": [{ id: doc.id, name: doc.name, format: doc.format, content_b64: b64(doc.bytes) }],
  });
const errorOf = (res: Awaited<ReturnType<typeof ingest>>) => {
  const first = res.content[0].text;
  // An error item is JSON; what could not be read among documents that could is a line of text.
  return first.startsWith("{") ? (JSON.parse(first).error?.message ?? first) : res.content.map((c) => c.text).join("\n");
};

describe("a document that is crafted or enormous", () => {
  it("a DOCX that is a ZIP bomb is refused before it is unpacked, and nothing is embedded", async () => {
    const bomb = makeZip([{ name: "word/document.xml", data: new Uint8Array(90 * 1024 * 1024) }]);
    const res = await ingest("alice:c1", { id: "bomb", name: "bomb.docx", format: "docx", bytes: bomb });
    expect(errorOf(res)).toContain("bomb.docx");
    expect(errorOf(res)).toMatch(/could not be read|far more than its size/);
    expect(embedCalls).toBe(0);
    expect(listDocuments("alice:c1")).toHaveLength(0);
  });

  it("a PDF with more pages than are read is refused with the numbers", async () => {
    const res = await ingest("alice:c1", { id: "long", name: "long.pdf", format: "pdf", bytes: makePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => `page ${i}`)) });
    expect(errorOf(res)).toMatch(/pages|could not be read/);
    expect(embedCalls).toBe(0);
  }, 60_000);

  it("a text with more characters than are read is refused", async () => {
    const res = await ingest("alice:c1", { id: "huge", name: "huge.txt", format: "txt", bytes: "word. ".repeat(Math.ceil((MAX_EXTRACTED_CHARS + 10) / 6)) });
    expect(errorOf(res)).toMatch(/characters|could not be read/);
    expect(embedCalls).toBe(0);
  }, 60_000);

  it("a text with no sentence ends is cut into chunks that can be embedded", () => {
    const chunks = chunkDocument("d", [{ text: "x".repeat(100_000) }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });

  it("garbage that is called a PDF is refused, and the server answers the next request", async () => {
    const bad = await ingest("alice:c1", { id: "x", name: "x.pdf", format: "pdf", bytes: "this is not a pdf at all" });
    expect(errorOf(bad)).toContain("x.pdf");
    const good = await ingest("alice:c1", { id: "g", name: "g.txt", format: "txt", bytes: "A sentence about foo. Another about bar." });
    expect(good.content[0].text).toContain("Hit 1");
  });
});

describe("what a chat may hold, checked before anything is paid for", () => {
  const tiny = (id: string, chunks = 1): StoredDocument => ({
    id,
    name: id,
    format: "txt",
    chunks: Array.from({ length: chunks }, (_, i) => ({ id: `${id}:${i}`, docId: id, index: i, text: "t", tokens: 1 })),
    embeddings: Array.from({ length: chunks }, () => [1, 0, 0, 0]),
    ingestedAt: Date.now(),
  });

  it("a chat that holds as many documents as it may does not embed another", async () => {
    for (let i = 0; i < MAX_DOCS_PER_CHAT; i++) await upsertDocument("alice:full", tiny(`d${i}`));
    const res = await ingest("alice:full", { id: "one-more", name: "one-more.txt", format: "txt", bytes: "Some text to read." });
    expect(errorOf(res)).toContain("documents");
    // The only thing embedded is the question of the search: not a word of the document.
    expect(embeddedTexts.some((t) => t.includes("Some text to read"))).toBe(false);
  });

  it("chats are dropped, the ones used longest ago first, when there are too many", async () => {
    for (let i = 0; i < MAX_STORES + 10; i++) await upsertDocument(`user:chat-${i}`, tiny("d"));
    expect(listDocuments("user:chat-0")).toHaveLength(0);
    expect(listDocuments(`user:chat-${MAX_STORES + 9}`)).toHaveLength(1);
  });

  it("chats are dropped when the passages of all of them are too many", async () => {
    const perChat = 4_000;
    const chats = Math.ceil(MAX_TOTAL_CHUNKS / perChat) + 4;
    for (let i = 0; i < chats; i++) await upsertDocument(`user:big-${i}`, tiny("d", perChat));
    expect(listDocuments("user:big-0")).toHaveLength(0);
    expect(listDocuments(`user:big-${chats - 1}`)).toHaveLength(1);
  }, 60_000);
});

describe("what a user may have read in an hour", () => {
  it("is limited, whichever chat the documents are in, and one user's use is not another's", async () => {
    process.env.INES_INGEST_CHUNKS_PER_HOUR = "3";
    // Paragraphs of about 2,000 characters: each is a chunk of its own.
    const text = (n: number) =>
      Array.from({ length: n }, (_, i) => `${Array.from({ length: 300 }, (_, j) => `word${i}x${j}`).join(" ")}.`).join("\n\n");
    const first = await ingest("alice:c1", { id: "a", name: "a.txt", format: "txt", bytes: text(2) });
    expect(first.content[0].text).toContain("Hit 1");
    const spent = embeddedValues;
    // Alice's next document, in another chat, goes over her hour's share: refused, and not embedded.
    const second = await ingest("alice:c2", { id: "b", name: "b.txt", format: "txt", bytes: text(12) });
    expect(errorOf(second)).toContain("limit");
    expect(embeddedValues).toBe(spent);
    // Bob has his own.
    const bob = await ingest("bob:c1", { id: "c", name: "c.txt", format: "txt", bytes: text(1) });
    expect(bob.content[0].text).toContain("Hit 1");
  });
});
