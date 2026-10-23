import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "expect";
import ExcelJS from "exceljs";
import { makeXlsx } from "../../../helpers/make-xlsx.ts";
import { logicalUrl } from "../../../helpers/logical-url.ts";
import { makeZip } from "../../../helpers/make-zip.ts";
import {
  extractWidgetItems,
  _classifyItem,
  _imageMediaType,
  _csvToJson,
  _xlsxToJson,
} from "../../../../src/widgets/parse.ts";
import type { ToolMessage, Widget } from "../../../../src/protocol/types.ts";

const makeXlsxBuffer = makeXlsx;

function widget(uuid: string, name = "W"): Widget {
  return {
    uuid,
    origin: "example",
    widget_id: uuid,
    name,
    description: "",
    params: [],
  };
}

function msg(
  data: ToolMessage["data"],
  queries: Array<{ widget_uuid: string }> = [],
): ToolMessage {
  return {
    role: "tool",
    function: "get_widget_data",
    input_arguments: { data_sources: queries },
    data,
  };
}

describe("extractWidgetItems — empty inputs", () => {
  it("returns empty array when data is undefined", async () => {
    const items = await extractWidgetItems(
      { ...msg([]), data: undefined as unknown as ToolMessage["data"] },
      [],
    );
    expect(items).toEqual([]);
  });

  it("returns empty array when data is empty", async () => {
    const items = await extractWidgetItems(msg([]), []);
    expect(items).toEqual([]);
  });
});

describe("extractWidgetItems — inline text content", () => {
  it("collects content into items keyed by data_sources index", async () => {
    const tm = msg(
      [{ items: [{ content: "hello" }, { content: "world" }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1", "First")]);
    expect(items).toHaveLength(1);
    expect(items[0].uuid).toBe("u-1");
    expect(items[0].name).toBe("First");
    expect(items[0].content).toBe("hello\nworld");
    expect(items[0].parts).toBeUndefined();
  });

  it("uses fallback name when widget UUID is not in allWidgets", async () => {
    const tm = msg([{ items: [{ content: "x" }] }], [{ widget_uuid: "missing" }]);
    const items = await extractWidgetItems(tm, []);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("widget_0");
    expect(items[0].uuid).toBe("missing");
  });

  it("uses fallback uuid when no data_sources entry exists for the index", async () => {
    const tm = msg([{ items: [{ content: "x" }] }], []);
    const items = await extractWidgetItems(tm, []);
    expect(items[0].uuid).toBe("unknown_0");
  });

  it("skips an entry that produces neither content nor media parts", async () => {
    const tm = msg([{ items: [{ content: "" }] }], [{ widget_uuid: "u-1" }]);
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items).toEqual([]);
  });
});

describe("extractWidgetItems — inline image", () => {
  it("emits an image media part with mediaType from data_format.data_type", async () => {
    const tm = msg(
      [
        {
          items: [
            { content: "Zm9v", data_format: { data_type: "png" } },
          ],
        },
      ],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items[0].parts).toBeDefined();
    expect(items[0].parts).toHaveLength(1);
    const part = items[0].parts![0] as { type: "image"; mediaType: string; image: string };
    expect(part.type).toBe("image");
    expect(part.mediaType).toBe("image/png");
    expect(part.image).toBe("Zm9v");
  });

  it("defaults image mediaType to image/jpeg for jpg/jpeg", async () => {
    const tm = msg(
      [{ items: [{ content: "abc", data_format: { data_type: "jpg" } }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    const part = items[0].parts![0] as { mediaType: string };
    expect(part.mediaType).toBe("image/jpeg");
  });

  it("skips images larger than the inline base64 limit", async () => {
    const huge = "A".repeat(5 * 1024 * 1024 + 1);
    const tm = msg(
      [{ items: [{ content: huge, data_format: { data_type: "png" } }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items).toHaveLength(0);
  });
});

describe("_classifyItem — file kind routing", () => {
  it("classifies image data_type variants (case-insensitive)", () => {
    expect(_classifyItem({ data_type: "png" })).toBe("image");
    expect(_classifyItem({ data_type: "PNG" })).toBe("image");
    expect(_classifyItem({ data_type: "jpg" })).toBe("image");
    expect(_classifyItem({ data_type: "JPEG" })).toBe("image");
  });

  it("classifies pdf data_type", () => {
    expect(_classifyItem({ data_type: "pdf" })).toBe("pdf");
    expect(_classifyItem({ data_type: "PDF" })).toBe("pdf");
  });

  it("classifies csv via data_type", () => {
    expect(_classifyItem({ data_type: "csv" })).toBe("csv");
  });

  it("infers csv from URL suffix when data_format missing", () => {
    expect(_classifyItem(undefined, "https://example.com/data.csv")).toBe("csv");
    expect(_classifyItem({}, "https://example.com/data.csv")).toBe("csv");
  });

  it("classifies xlsx via data_type or URL suffix", () => {
    expect(_classifyItem({ data_type: "xlsx" })).toBe("xlsx");
    expect(_classifyItem({ data_type: "xls" })).toBe("xlsx");
    expect(_classifyItem(undefined, "https://example.com/data.xlsx")).toBe("xlsx");
    expect(_classifyItem(undefined, "https://example.com/data.xls")).toBe("xlsx");
  });

  it("regression: txt / md / html / unknown fall through to text; docx is a document like pdf", () => {
    expect(_classifyItem({ data_type: "docx" })).toBe("docx");
    expect(_classifyItem(undefined, "https://example.com/files/report.docx")).toBe("docx");
    expect(_classifyItem({ data_type: "html" })).toBe("text");
    expect(_classifyItem({ data_type: "txt" })).toBe("text");
    expect(_classifyItem({ data_type: "md" })).toBe("text");
    expect(_classifyItem({ data_type: "unknown_format" })).toBe("text");
    expect(_classifyItem(undefined, undefined)).toBe("text");
  });

  it("data_type wins over URL when both present", () => {
    expect(_classifyItem({ data_type: "pdf" }, "https://example.com/foo.csv")).toBe("pdf");
  });
});

describe("_imageMediaType", () => {
  it("returns image/png for png", () => {
    expect(_imageMediaType("png")).toBe("image/png");
  });

  it("returns image/jpeg fallback for jpg / jpeg / unknown / empty", () => {
    expect(_imageMediaType("jpg")).toBe("image/jpeg");
    expect(_imageMediaType("jpeg")).toBe("image/jpeg");
    expect(_imageMediaType("")).toBe("image/jpeg");
    expect(_imageMediaType("gif")).toBe("image/jpeg");
  });
});

describe("_csvToJson", () => {
  it("parses a simple csv with header and rows", () => {
    const out = JSON.parse(_csvToJson("a,b\n1,2\n3,4"));
    expect(out).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
  });

  it("coerces numeric cells; leaves non-numeric strings as-is", () => {
    const out = JSON.parse(_csvToJson("symbol,price\nAAPL,200\nNVDA,1000"));
    expect(out).toEqual([
      { symbol: "AAPL", price: 200 },
      { symbol: "NVDA", price: 1000 },
    ]);
  });

  it("returns [] when input has < 2 lines", () => {
    expect(_csvToJson("only-header")).toBe("[]");
    expect(_csvToJson("")).toBe("[]");
  });

  it("strips UTF-8 BOM from header", () => {
    const out = JSON.parse(_csvToJson("﻿a,b\n1,2"));
    expect(out[0]).toHaveProperty("a", 1);
    expect(out[0]).toHaveProperty("b", 2);
  });

  it("handles quoted commas inside fields", () => {
    const out = JSON.parse(_csvToJson('name,note\n"Smith, J",hi'));
    expect(out).toEqual([{ name: "Smith, J", note: "hi" }]);
  });

  it("skips blank rows", () => {
    const out = JSON.parse(_csvToJson("a,b\n1,2\n\n3,4"));
    expect(out).toHaveLength(2);
  });

  it("regression: documented limitation — escaped double-quotes (`\"\"`) flip inQuotes (no escape support)", () => {
    // Pinning current behavior. If we add proper RFC-4180 escape handling
    // later, update parse.ts AND replace this test.
    const out = JSON.parse(_csvToJson('a,b\n"he said ""hi""",ok'));
    // The escaped `""` toggles inQuotes off then on, so the comma inside
    // is treated as a delimiter. We get more cells than expected.
    expect(out[0]).not.toEqual({ a: 'he said "hi"', b: "ok" });
  });

  it("missing trailing values default to empty string", () => {
    const out = JSON.parse(_csvToJson("a,b,c\n1,2"));
    expect(out[0]).toEqual({ a: 1, b: 2, c: "" });
  });
});

describe("extractWidgetItems — URL-based image (production path)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("fetches the image and hands the model its bytes, not the link: the link is signed and the provider cannot reach it", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    let fetched = "";
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      fetched = logicalUrl(input, init);
      return new Response(png);
    }) as unknown as typeof fetch;
    const tm = msg(
      [{ items: [{ url: "https://files.example.com/chart.png?Signature=secret", data_format: { data_type: "png" } }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(fetched).toBe("https://files.example.com/chart.png?Signature=secret");
    expect(items[0].parts).toHaveLength(1);
    const part = items[0].parts![0] as { type: "image"; image: string; mediaType: string };
    expect(part.type).toBe("image");
    expect(part.image).toBe(Buffer.from(png).toString("base64"));
    expect(part.mediaType).toBe("image/png");
    expect(JSON.stringify(part)).not.toContain("secret");
  });

  it("drops an image it cannot fetch, without throwing", async () => {
    globalThis.fetch = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const tm = msg(
      [{ items: [{ url: "https://files.example.com/gone.png", data_format: { data_type: "png" } }] }],
      [{ widget_uuid: "u-1" }],
    );
    expect(await extractWidgetItems(tm, [widget("u-1")])).toHaveLength(0);
  });
});

describe("extractWidgetItems — URL-based PDF / CSV / text (mocked fetch)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(handler: (url: string) => Response | Promise<Response>) {
    globalThis.fetch = ((input: unknown) => {
      const url = input instanceof URL ? input.href : (input as string);
      return Promise.resolve(handler(url));
    }) as unknown as typeof fetch;
  }

  it("PDF URL: is a document, and is not fetched: the document search fetches it", async () => {
    let fetched = 0;
    mockFetch(() => {
      fetched++;
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    });
    const tm = msg(
      [{ items: [{ url: "https://example.com/path/report.pdf", data_format: { data_type: "pdf" } }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items).toHaveLength(1);
    expect(items[0].documentFormat).toBe("pdf");
    expect(items[0].content).toBe("");
    expect(items[0].parts).toBeUndefined();
    expect(fetched).toBe(0);
  });

  it("PDF URL: a link the agent could not reach is still a document: nothing is fetched here", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    const tm = msg(
      [{ items: [{ url: "https://files.example.com/err.pdf", data_format: { data_type: "pdf" } }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items[0].documentFormat).toBe("pdf");
  });

  it("DOCX URL: a document too, found by its data_type or its link's suffix", async () => {
    const byType = msg(
      [{ items: [{ url: "https://files.example.com/a?x=1", data_format: { data_type: "docx" } }] }],
      [{ widget_uuid: "u-1" }],
    );
    const bySuffix = msg([{ items: [{ url: "https://files.example.com/b.docx" }] }], [{ widget_uuid: "u-1" }]);
    expect((await extractWidgetItems(byType, [widget("u-1")]))[0].documentFormat).toBe("docx");
    expect((await extractWidgetItems(bySuffix, [widget("u-1")]))[0].documentFormat).toBe("docx");
  });

  it("CSV URL: fetches, converts to JSON via _csvToJson, lands as content text", async () => {
    mockFetch(() => new Response("a,b\n1,2\n3,4"));
    const tm = msg(
      [{ items: [{ url: "https://files.example.com/data.csv" }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items[0].content).toContain('"a":1');
    expect(items[0].content).toContain('"b":4');
    expect(items[0].parts).toBeUndefined();
  });

  it("Generic text URL: fetches text and pushes verbatim into content", async () => {
    mockFetch(() => new Response("plain prose body"));
    const tm = msg(
      [{ items: [{ url: "https://files.example.com/note.txt" }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items[0].content).toBe("plain prose body");
  });

  it("Generic URL fetch failure logs but does not throw — item dropped", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("DNS fail"))) as unknown as typeof fetch;
    const tm = msg(
      [{ items: [{ url: "https://nowhere.example.com/foo" }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items).toHaveLength(0);
  });
});

describe("extractWidgetItems — inline PDF", () => {
  it("is a document, not a file part for the model", async () => {
    const tm = msg(
      [{ items: [{ content: "JVBERi0xLjQK", data_format: { data_type: "pdf", filename: "report.pdf" } }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items).toHaveLength(1);
    expect(items[0].documentFormat).toBe("pdf");
    expect(items[0].parts).toBeUndefined();
    expect(items[0].content).toBe("");
  });
});

describe("_xlsxToJson", () => {
  it("converts the first sheet to JSON rows", async () => {
    const buf = await makeXlsxBuffer([
      { ticker: "AAPL", price: 200 },
      { ticker: "MSFT", price: 410 },
    ]);
    const json = await _xlsxToJson(buf);
    const rows = JSON.parse(json) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ticker: "AAPL", price: 200 });
    expect(rows[1]).toMatchObject({ ticker: "MSFT", price: 410 });
  });

  it("returns empty array string when the first sheet has no rows", async () => {
    const buf = await makeXlsxBuffer([]);
    expect(await _xlsxToJson(buf)).toBe("[]");
  });

  async function workbook(build: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    build(wb.addWorksheet("S"));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const rowsOf = async (buf: Buffer) => JSON.parse(await _xlsxToJson(buf)) as Array<Record<string, unknown>>;

  it("reads only the first sheet", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("First").addRows([["a"], [1]]);
    wb.addWorksheet("Second").addRows([["b"], [2]]);
    expect(await rowsOf(Buffer.from(await wb.xlsx.writeBuffer()))).toEqual([{ a: 1 }]);
  });

  it("names an empty heading for its column and numbers a repeated one", async () => {
    const buf = await workbook((s) => s.addRows([["x", null, "x", "y"], [1, 2, 3, 4]]));
    expect(await rowsOf(buf)).toEqual([{ x: 1, column_2: 2, x_1: 3, y: 4 }]);
  });

  it("leaves out a row with nothing in it, and keeps a cell with nothing in it as null", async () => {
    const buf = await workbook((s) => s.addRows([["a", "b"], [1, null], [null, null], [3, 4]]));
    expect(await rowsOf(buf)).toEqual([{ a: 1, b: null }, { a: 3, b: 4 }]);
  });

  it("reads the result of a formula, the text of a link and rich text, and a date as ISO text", async () => {
    const buf = await workbook((s) => {
      s.addRow(["formula", "link", "rich", "date", "flag"]);
      s.addRow([
        { formula: "1+2", result: 3 },
        { text: "Example", hyperlink: "https://example.com" },
        { richText: [{ text: "Hello " }, { text: "world" }] },
        new Date("2026-03-14T00:00:00Z"),
        true,
      ]);
    });
    expect(await rowsOf(buf)).toEqual([{ formula: 3, link: "Example", rich: "Hello world", date: "2026-03-14T00:00:00.000Z", flag: true }]);
  });

  it("refuses a spreadsheet that is a ZIP bomb, before it is unpacked", async () => {
    const bomb = makeZip([{ name: "xl/worksheets/sheet1.xml", data: new Uint8Array(90 * 1024 * 1024) }]);
    await expect(_xlsxToJson(Buffer.from(bomb))).rejects.toThrow(/far more than its size/);
  });

  it("refuses a file that is not a workbook, and a workbook cut short", async () => {
    await expect(_xlsxToJson(Buffer.from("not a spreadsheet"))).rejects.toThrow();
    const good = await makeXlsxBuffer([{ a: 1 }]);
    await expect(_xlsxToJson(good.subarray(0, 40))).rejects.toThrow();
  });
});

describe("extractWidgetItems — xlsx", () => {
  it("decodes inline base64 xlsx into JSON rows in content", async () => {
    const rows = [{ year: 2024, revenue: 21301 }];
    const b64 = (await makeXlsxBuffer(rows)).toString("base64");
    const tm = msg(
      [{ items: [{ content: b64, data_format: { data_type: "xlsx" } }] }],
      [{ widget_uuid: "u-1" }],
    );
    const items = await extractWidgetItems(tm, [widget("u-1")]);
    expect(items).toHaveLength(1);
    expect(items[0].parts).toBeUndefined();
    const parsed = JSON.parse(items[0].content) as Array<Record<string, unknown>>;
    expect(parsed).toEqual([{ year: 2024, revenue: 21301 }]);
  });

  it("fetches xlsx URL and converts to JSON", async () => {
    const buf = await makeXlsxBuffer([{ a: 1, b: "x" }]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(buf)) as unknown as typeof fetch;
    try {
      const tm = msg(
        [
          {
            items: [
              {
                url: "https://example.com/sheet.xlsx",
                data_format: { data_type: "xlsx" },
              },
            ],
          },
        ],
        [{ widget_uuid: "u-1" }],
      );
      const items = await extractWidgetItems(tm, [widget("u-1")]);
      expect(items).toHaveLength(1);
      const parsed = JSON.parse(items[0].content) as Array<Record<string, unknown>>;
      expect(parsed).toEqual([{ a: 1, b: "x" }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("classifies xlsx by URL suffix when data_format is absent", async () => {
    const buf = await makeXlsxBuffer([{ q: 1 }]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(buf)) as unknown as typeof fetch;
    try {
      const tm = msg(
        [{ items: [{ url: "https://example.com/d.xlsx" }] }],
        [{ widget_uuid: "u-1" }],
      );
      const items = await extractWidgetItems(tm, [widget("u-1")]);
      const parsed = JSON.parse(items[0].content) as Array<Record<string, unknown>>;
      expect(parsed).toEqual([{ q: 1 }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
