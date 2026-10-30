import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { makeXlsx } from "../../helpers/make-xlsx.ts";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import type { QueryRequest, ToolMessage, Widget } from "../../../src/protocol/types.ts";
import { llmEmitsText, makeSpyMockLlm } from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";

beforeEach(() => clearAllModuleState());

async function makeXlsxB64(rows: Record<string, unknown>[]): Promise<string> {
  return (await makeXlsx(rows)).toString("base64");
}

const widget: Widget = {
  uuid: "chart-1",
  origin: "example",
  widget_id: "chart",
  name: "Sample Chart",
  description: "A chart",
  params: [],
  metadata: { extension: "png" },
};

interface LlmCall {
  messages?: Array<{
    role: string;
    content: unknown;
  }>;
}

function findUserPartsMessage(call: LlmCall): unknown[] | undefined {
  const msgs = call.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "user" && Array.isArray(m.content)) {
      return m.content as unknown[];
    }
  }
  return undefined;
}

describe("file widget — image inline content reaches the LLM as ImagePart", () => {
  it("regression: prior tool message with png base64 → next generateText call sees ImagePart", async () => {
    const priorTool: ToolMessage = {
      role: "tool",
      function: "get_widget_data",
      input_arguments: { data_sources: [{ widget_uuid: "chart-1" }] },
      data: [
        {
          items: [
            { content: "Zm9vYmFy", data_format: { data_type: "png" } },
          ],
        },
      ],
    };
    const spy = makeSpyMockLlm(llmEmitsText("looks like a chart"));
    await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "what's in the chart?" },
            priorTool,
          ],
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [widget],
        workspaceState: null,
        conversationId: "file-png",
      }),
    );
    expect(spy.calls.length).toBeGreaterThan(0);
    const parts = findUserPartsMessage(spy.calls[0] as LlmCall);
    expect(parts).toBeDefined();
    const imagePart = (parts as Array<Record<string, unknown>>).find(
      (p) => typeof p.mediaType === "string" && (p.mediaType as string).startsWith("image/"),
    );
    expect(imagePart).toBeDefined();
    expect((imagePart as { mediaType: string }).mediaType).toBe("image/png");
  });
});

describe("file widget — a PDF is searched, not shown", () => {
  const pdfWidget: Widget = {
    uuid: "pdf-1",
    origin: "the backend",
    widget_id: "file-pdf-1",
    name: "Project Kestrel Plan",
    description: "A plan",
    params: [],
    metadata: { extension: "pdf", originalFileName: "kestrel-plan.pdf" },
  };
  const loaded = (item: Record<string, unknown>): ToolMessage => ({
    role: "tool",
    function: "get_widget_data",
    input_arguments: { data_sources: [{ widget_uuid: "pdf-1" }] },
    data: [{ items: [item] }],
  });
  const documentTools = [
    {
      name: "Agent Tools_query_documents",
      tool_name: "query_documents",
      server_id: "agent-tools",
      url: "http://agent-mcp:8787/mcp",
      description: "Search documents",
      input_schema: { properties: { query: { type: "string" } }, required: ["query"] },
    },
  ];

  async function run(item: Record<string, unknown>, tools: unknown[]) {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: "summarize the pdf" }, loaded(item)],
          tools,
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [pdfWidget],
        workspaceState: null,
        conversationId: "file-pdf",
      }),
    );
    return JSON.stringify(spy.calls[0].messages);
  }

  it("never gives the model the PDF as a file: a model that cannot take one refuses the whole request", async () => {
    const prompt = await run({ content: "JVBERi0xLjQK", data_format: { data_type: "pdf", filename: "report.pdf" } }, documentTools);
    expect(prompt).not.toContain("application/pdf");
    expect(prompt).not.toContain("JVBERi0xLjQK");
  });

  it("says that it is loaded for searching, with the tool and the id to search it by", async () => {
    const prompt = await run(
      { url: "http://api:8000/app/files/presigned/a.pdf?Signature=s", data_format: { data_type: "pdf", filename: "kestrel-plan.pdf" } },
      documentTools,
    );
    expect(prompt).toContain("[FILE: pdf]");
    expect(prompt).toContain("This PDF file is loaded for searching");
    expect(prompt).toContain("query_documents");
    expect(prompt).toContain('doc_ids [\\"pdf-1\\"]');
    expect(prompt).toContain("which page it is on");
    expect(prompt).not.toContain("Signature");
  });

  it("says plainly that it cannot be read when there is no document search", async () => {
    const prompt = await run({ url: "http://api:8000/app/files/presigned/a.pdf", data_format: { data_type: "pdf" } }, []);
    expect(prompt).toContain("cannot be read: document search is not available");
    expect(prompt).not.toContain("This PDF file is loaded for searching");
  });
});

describe("file widget — inline xlsx content reaches LLM as JSON table", () => {
  it("regression: prior tool message with xlsx base64 → next generateText sees structured rows text", async () => {
    const xlsxWidget: Widget = {
      uuid: "xlsx-1",
      origin: "example",
      widget_id: "file-xlsx-1",
      name: "Sheet",
      description: "uploaded sheet",
      params: [],
      metadata: { extension: "xlsx" },
    };
    const b64 = await makeXlsxB64([{ ticker: "AAPL", price: 200 }]);
    const priorTool: ToolMessage = {
      role: "tool",
      function: "get_widget_data",
      input_arguments: { data_sources: [{ widget_uuid: "xlsx-1" }] },
      data: [
        {
          items: [{ content: b64, data_format: { data_type: "xlsx" } }],
        },
      ],
    };
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "what's the price?" },
            priorTool,
          ],
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [xlsxWidget],
        workspaceState: null,
        conversationId: "file-xlsx",
      }),
    );
    const parts = findUserPartsMessage(spy.calls[0] as LlmCall) ?? [];
    const textPart = (parts as Array<Record<string, unknown>>)
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("\n");
    expect(textPart).toContain("AAPL");
    expect(textPart).toContain("200");
  });
});

describe("file widget — system prompt tags file widgets", () => {
  it("regression: widget metadata.extension === 'pdf' surfaces `[FILE: pdf]` to the model", async () => {
    const pdfWidget: Widget = {
      ...widget,
      uuid: "pdf-1",
      name: "Report",
      metadata: { extension: "pdf" },
    };
    const spy = makeSpyMockLlm(llmEmitsText("ack"));
    await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: "look at the report" }],
          widgets: { primary: [pdfWidget] },
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [pdfWidget],
        workspaceState: null,
        conversationId: "file-tag",
      }),
    );
    const sysMsg = (spy.calls[0]?.messages as Array<{ role: string; content: string }> | undefined)
      ?.find((m) => m.role === "system");
    expect(sysMsg?.content).toContain("[FILE: pdf]");
  });
});

describe("file widget — a long text file is cut, not sent whole", () => {
  const txtWidget: Widget = {
    uuid: "txt-1",
    origin: "the backend",
    widget_id: "file-txt-1",
    name: "Notes",
    description: "Long notes",
    params: [],
    metadata: { extension: "txt" },
  };
  const loaded = (content: string): ToolMessage => ({
    role: "tool",
    function: "get_widget_data",
    input_arguments: { data_sources: [{ widget_uuid: "txt-1" }] },
    data: [{ items: [{ content, data_format: { data_type: "txt", filename: "notes.txt" } }] }],
  });
  const searchTool = {
    name: "Agent Tools_query_documents",
    tool_name: "query_documents",
    server_id: "agent-tools",
    url: "http://agent-mcp:8787/mcp",
    description: "Search documents",
    input_schema: { properties: { query: { type: "string" } }, required: ["query"] },
  };

  async function run(content: string, tools: unknown[]) {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "summarise the notes" }, loaded(content)], tools } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [txtWidget],
        workspaceState: null,
        conversationId: "file-txt",
      }),
    );
    return JSON.stringify(spy.calls[0].messages);
  }

  it("gives the start of it, and how much was left out", async () => {
    const prompt = await run(`BEGIN ${"word ".repeat(100_000)} FINISH`, []);
    expect(prompt).toContain("BEGIN");
    expect(prompt).not.toContain("FINISH");
    expect(prompt).toMatch(/more characters are not shown/);
    expect(prompt.length).toBeLessThan(60_000);
  });

  it("says where to read the rest when the file can be searched", async () => {
    const prompt = await run(`BEGIN ${"word ".repeat(100_000)} FINISH`, [searchTool]);
    expect(prompt).toContain("query_documents");
    expect(prompt).toContain('doc_ids [\\"txt-1\\"]');
  });

  it("gives all of a file that fits", async () => {
    const prompt = await run("a short note", []);
    expect(prompt).toContain("a short note");
    expect(prompt).not.toContain("not shown");
  });
});
