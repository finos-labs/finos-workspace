import { describe, it } from "node:test";
import { expect } from "expect";
import { extractFileTierDocs } from "../../../../src/agent/file-docs.ts";
import { buildDocumentsDecoration } from "../../../../src/agent/documents.ts";
import type { ToolMessage, Widget } from "../../../../src/protocol/types.ts";

const widget = (uuid: string, name: string, extension: string): Widget => ({
  uuid,
  origin: "the backend",
  widget_id: `file-${uuid}`,
  name,
  description: "",
  params: [],
  metadata: { extension },
});

const loaded = (uuids: string[], items: Record<string, unknown>[]): ToolMessage => ({
  role: "tool",
  function: "get_widget_data",
  input_arguments: { data_sources: uuids.map((widget_uuid) => ({ widget_uuid })) },
  data: items.map((item) => ({ items: [item] })),
});

describe("extractFileTierDocs", () => {
  it("passes a file on by its link, and fetches nothing", async () => {
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched++;
      return new Response("x");
    }) as unknown as typeof fetch;
    try {
      const docs = await extractFileTierDocs(
        loaded(["w1"], [{ url: "http://localhost:8000/app/files/presigned/a.pdf?Expires=1&Signature=s", data_format: { data_type: "pdf" } }]),
        [widget("w1", "Plan", "pdf")],
      );
      expect(docs).toEqual([
        { id: "w1", name: "Plan", format: "pdf", url: "http://localhost:8000/app/files/presigned/a.pdf?Expires=1&Signature=s" },
      ]);
      expect(fetched).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("finds the format from the link's path when there is no data_format: a signed link ends in its signature", async () => {
    const docs = await extractFileTierDocs(
      loaded(["w1"], [{ url: "http://localhost:8000/app/files/presigned/a.docx?Expires=1&Signature=pdf" }]),
      [widget("w1", "Doc", "docx")],
    );
    expect(docs[0].format).toBe("docx");
  });

  it("keeps the bytes of a file that arrived inline, and skips one that is too large", async () => {
    const small = await extractFileTierDocs(
      loaded(["w1"], [{ content: Buffer.from("hello").toString("base64"), data_format: { data_type: "txt" } }]),
      [widget("w1", "Note", "txt")],
    );
    expect(Buffer.from(small[0].bytes!).toString()).toBe("hello");
    expect(small[0].url).toBeUndefined();

    const huge = await extractFileTierDocs(
      loaded(["w1"], [{ content: "A".repeat(40 * 1024 * 1024), data_format: { data_type: "pdf" } }]),
      [widget("w1", "Big", "pdf")],
    );
    expect(huge).toEqual([]);
  });

  it("leaves out what is not a file widget, and formats the document search does not read", async () => {
    const notFile: Widget = { ...widget("w1", "Table", "pdf"), widget_id: "prices" };
    expect(await extractFileTierDocs(loaded(["w1"], [{ url: "http://x/a.pdf", data_format: { data_type: "pdf" } }]), [notFile])).toEqual([]);
    expect(await extractFileTierDocs(loaded(["w1"], [{ url: "http://x/a.csv", data_format: { data_type: "csv" } }]), [widget("w1", "T", "csv")])).toEqual([]);
  });
});

describe("buildDocumentsDecoration", () => {
  it("ships a link as a link and bytes as base64, each document once", () => {
    const pending = new Map([
      ["a", { id: "a", name: "A", format: "pdf" as const, url: "http://api/files/a.pdf" }],
      ["b", { id: "b", name: "B", format: "txt" as const, bytes: new TextEncoder().encode("hi") }],
    ]);
    const shipped = new Set<string>();
    const delta = buildDocumentsDecoration(pending, shipped)!;
    expect(delta).toEqual([
      { id: "a", name: "A", format: "pdf", url: "http://api/files/a.pdf" },
      { id: "b", name: "B", format: "txt", content_b64: Buffer.from("hi").toString("base64") },
    ]);
    shipped.add("a");
    expect(buildDocumentsDecoration(pending, shipped)).toEqual([delta[1]]);
    shipped.add("b");
    expect(buildDocumentsDecoration(pending, shipped)).toBeNull();
  });
});
