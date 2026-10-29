import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "expect";
import { makePdf } from "../../../../../helpers/make-pdf.ts";
import { logicalUrl } from "../../../../../helpers/logical-url.ts";
import { MockEmbeddingModelV3 } from "ai/test";
import { queryDocumentsHandler } from "../../../../../../mcp-server/src/tools/backend/documents/query-documents.ts";
import {
  _resetEmbeddingModel,
  _setEmbeddingModelForTest,
} from "../../../../../../mcp-server/src/tools/backend/documents/retrieve.ts";
import { _resetDocStoreState } from "../../../../../../mcp-server/src/tools/backend/documents/store.ts";

const VEC_FOO = [1, 0, 0, 0];
const VEC_BAR = [0, 1, 0, 0];

function utf8B64(s: string): string {
  return Buffer.from(new TextEncoder().encode(s)).toString("base64");
}

function makeFakeEmbed(): MockEmbeddingModelV3 {
  return new MockEmbeddingModelV3({
    doEmbed: async ({ values }) => ({
      embeddings: values.map((v) =>
        v.toLowerCase().includes("foo") ? VEC_FOO : VEC_BAR,
      ),
      warnings: [],
    }),
  });
}

beforeEach(() => {
  _resetDocStoreState();
  _setEmbeddingModelForTest(makeFakeEmbed());
});

afterEach(() => {
  _resetEmbeddingModel();
});

describe("queryDocumentsHandler — guards", () => {
  it("returns MISSING_CONVERSATION_ID error when decoration absent", async () => {
    const res = await queryDocumentsHandler({ query: "hello" });
    expect(res.content).toHaveLength(1);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.$ines_kind).toBe("error");
    expect(parsed.error.code).toBe("MISSING_CONVERSATION_ID");
  });

  it("returns NO_DOCUMENTS_LOADED when conversation has no docs", async () => {
    const res = await queryDocumentsHandler({
      query: "anything",
      "x-ines-conversation-id": "c-empty",
    });
    expect(res.content).toHaveLength(1);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.error.code).toBe("NO_DOCUMENTS_LOADED");
  });
});

describe("queryDocumentsHandler — happy path", () => {
  it("ingests new docs from decoration and returns ranked chunks + citations", async () => {
    const res = await queryDocumentsHandler({
      query: "tell me about foo",
      "x-ines-conversation-id": "c-1",
      "x-ines-documents": [
        {
          id: "d-1",
          name: "FooDoc.txt",
          format: "txt",
          content_b64: utf8B64(
            "Sentence about foo. Another sentence on foo. Conclusion on foo.",
          ),
        },
      ],
    });

    expect(res.content.length).toBeGreaterThanOrEqual(2);
    expect(res.content[0].text).toContain("Hit 1");
    expect(res.content[0].text).toContain("FooDoc.txt");
    const last = JSON.parse(res.content[res.content.length - 1].text);
    expect(last.$ines_kind).toBe("citation");
    expect(last.citation.type).toBe("document");
    expect(last.citation.title).toBe("FooDoc.txt");
  });

  it("filters by doc_ids when provided", async () => {
    await queryDocumentsHandler({
      query: "warmup",
      "x-ines-conversation-id": "c-2",
      "x-ines-documents": [
        {
          id: "doc-foo",
          name: "Foo.txt",
          format: "txt",
          content_b64: utf8B64("Content about foo. Another foo line."),
        },
        {
          id: "doc-bar",
          name: "Bar.txt",
          format: "txt",
          content_b64: utf8B64("Content about bar. Another bar line."),
        },
      ],
    });
    const filtered = await queryDocumentsHandler({
      query: "any topic",
      doc_ids: ["doc-foo"],
      "x-ines-conversation-id": "c-2",
    });
    const allText = filtered.content.map((c) => c.text).join("\n");
    expect(allText).toContain("Foo.txt");
    expect(allText).not.toContain("Bar.txt");
  });

  it("does not re-ingest docs already in the store", async () => {
    const decoration = [
      {
        id: "doc-foo",
        name: "Foo.txt",
        format: "txt" as const,
        content_b64: utf8B64("Content about foo."),
      },
    ];
    const r1 = await queryDocumentsHandler({
      query: "first call",
      "x-ines-conversation-id": "c-3",
      "x-ines-documents": decoration,
    });
    expect(r1.content.length).toBeGreaterThan(0);

    const r2 = await queryDocumentsHandler({
      query: "second call",
      "x-ines-conversation-id": "c-3",
      "x-ines-documents": decoration,
    });
    expect(r2.content.length).toBeGreaterThan(0);
    expect(r2.content[0].text).not.toContain("could not be ingested");
  });
});

describe("queryDocumentsHandler — PDFs", () => {
  const pdfB64 = (pages: string[]) => Buffer.from(makePdf(pages)).toString("base64");
  const pageCitations = (res: Awaited<ReturnType<typeof queryDocumentsHandler>>) =>
    res.content
      .filter((c) => c.text.startsWith("{"))
      .map((c) => JSON.parse(c.text))
      .filter((c) => c.$ines_kind === "citation")
      .map((c) => c.citation);

  it("tags every hit with its page and cites the page the answer is on", async () => {
    const res = await queryDocumentsHandler({
      query: "foo",
      "x-ines-conversation-id": "c-pdf",
      "x-ines-documents": [
        {
          id: "w-1",
          name: "plan.pdf",
          format: "pdf",
          content_b64: pdfB64(["Intro about bar", "The budget is foo dollars", "Risks about bar"]),
        },
      ],
    });
    expect(res.content[0].text).toContain("plan.pdf p.2");
    const cites = pageCitations(res);
    expect(cites[0]).toMatchObject({ type: "document", id: "w-1", title: "plan.pdf", page: 2 });
  });

  it("reports every page it returned, with how well it matched", async () => {
    const res = await queryDocumentsHandler({
      query: "foo",
      "x-ines-conversation-id": "c-pdf-2",
      "x-ines-documents": [
        {
          id: "w-1",
          name: "plan.pdf",
          format: "pdf",
          content_b64: pdfB64(["bar one", "foo two", "bar three", "bar four"]),
        },
      ],
    });
    const cites = pageCitations(res);
    expect(cites.map((c) => c.page).sort()).toEqual([1, 2, 3, 4]);
    const best = cites.find((c) => c.page === 2);
    expect(best.score).toBeGreaterThan(cites.find((c) => c.page === 1).score);
  });

  it("reports a page once, however many passages of it matched", async () => {
    const res = await queryDocumentsHandler({
      query: "foo",
      "x-ines-conversation-id": "c-pdf-dup",
      "x-ines-documents": [
        { id: "w-1", name: "plan.pdf", format: "pdf", content_b64: pdfB64(["foo ".repeat(1500)]) },
      ],
    });
    expect(pageCitations(res).map((c) => c.page)).toEqual([1]);
  });

  it("reads a PDF that is shipped as a link, fetching it from where the link points", async () => {
    const real = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      asked.push(logicalUrl(url, init));
      return new Response(makePdf(["Nothing here", "The supplier delay is foo weeks"]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }) as unknown as typeof fetch;
    try {
      const res = await queryDocumentsHandler({
        query: "foo",
        "x-ines-conversation-id": "c-pdf-url",
        "x-ines-documents": [{ id: "w-2", name: "plan.pdf", format: "pdf", url: "https://files.example.com/plan.pdf?sig=1" }],
      });
      expect(asked).toEqual(["https://files.example.com/plan.pdf?sig=1"]);
      expect(res.content[0].text).toContain("plan.pdf p.2");
      expect(pageCitations(res)[0]).toMatchObject({ id: "w-2", page: 2 });
    } finally {
      globalThis.fetch = real;
    }
  });

  it("says a link that does not give the file could not be read, rather than answering from nothing", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch;
    try {
      const res = await queryDocumentsHandler({
        query: "foo",
        "x-ines-conversation-id": "c-pdf-403",
        "x-ines-documents": [{ id: "w-3", name: "plan.pdf", format: "pdf", url: "https://files.example.com/plan.pdf" }],
      });
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.error.code).toBe("NO_DOCUMENTS_LOADED");
      expect(parsed.error.message).toContain("plan.pdf");
      expect(parsed.error.message).toContain("403");
    } finally {
      globalThis.fetch = real;
    }
  });

  it("says a PDF that is only pictures has no text to search", async () => {
    const res = await queryDocumentsHandler({
      query: "foo",
      "x-ines-conversation-id": "c-pdf-scan",
      "x-ines-documents": [{ id: "w-4", name: "scan.pdf", format: "pdf", content_b64: pdfB64(["", ""]) }],
    });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.error.code).toBe("NO_DOCUMENTS_LOADED");
    expect(parsed.error.message).toContain("scan.pdf");
    expect(parsed.error.message).toContain("no text to search");
  });

  it("refuses a link to a private address", async () => {
    const res = await queryDocumentsHandler({
      query: "foo",
      "x-ines-conversation-id": "c-pdf-ssrf",
      "x-ines-documents": [{ id: "w-5", name: "plan.pdf", format: "pdf", url: "http://169.254.169.254/latest/meta-data" }],
    });
    expect(JSON.parse(res.content[0].text).error.code).toBe("NO_DOCUMENTS_LOADED");
  });
});
