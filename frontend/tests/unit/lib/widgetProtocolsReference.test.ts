import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentToolConfig, McpServer } from "~/lib/state/mcpTools";
import { activeMcpLink, citeMcpCall } from "~/lib/utils/mcpLink";
import { rowsOf } from "~/lib/utils/rawRows";
import { contractProblems } from "~/lib/utils/widgetsContractChecks";

const OUT = process.env.REFERENCE_OUT ?? "";

const text = (name: string, extra: Record<string, unknown> = {}) => ({
  paramName: name,
  type: "text",
  ...extra,
});

const contractCases: {
  label: string;
  widget: Record<string, unknown>;
  context?: { credentialHeaders?: string[]; credentialQuery?: string[] };
}[] = [
  {
    label: "Two parameters have the same name",
    widget: { endpoint: "e", params: [text("a"), text("a")] },
  },
  {
    label: "A path placeholder names no parameter",
    widget: { endpoint: "e/{a}", params: [] },
  },
  {
    label: "A parameter that fills a path placeholder declares `in`",
    widget: { endpoint: "e/{a}", params: [text("a", { in: "query" })] },
  },
  {
    label: "A parameter that fills a path placeholder takes several values",
    widget: { endpoint: "e/{a}", params: [text("a", { multiple: true })] },
  },
  {
    label: "A form declares an input twice",
    widget: {
      endpoint: "e",
      params: [
        {
          type: "form",
          paramName: "f",
          endpoint: "f",
          inputParams: [text("a"), text("a")],
        },
      ],
    },
  },
  {
    label: "A form endpoint has a placeholder that names no input or parameter",
    widget: {
      endpoint: "e",
      params: [{ type: "form", paramName: "f", endpoint: "f/{a}", inputParams: [] }],
    },
  },
  {
    label: "An options endpoint has a placeholder that optionsParams does not fill",
    widget: {
      endpoint: "e",
      params: [{ paramName: "a", type: "endpoint", optionsEndpoint: "o/{b}" }],
    },
  },
  {
    label: "An optionsParams value names no parameter",
    widget: {
      endpoint: "e",
      params: [
        {
          paramName: "a",
          type: "endpoint",
          optionsEndpoint: "o",
          optionsParams: { k: "$b" },
        },
      ],
    },
  },
  {
    label: "Two parameters have the role `fileSelector`",
    widget: {
      endpoint: "e",
      params: [
        text("a", { roles: ["fileSelector"] }),
        text("b", { roles: ["fileSelector"] }),
      ],
    },
  },
  {
    label: "`refetchInterval` is not a cron expression",
    widget: { endpoint: "e", refetchInterval: "x" },
  },
  {
    label: "`dataUpdateDisplay` is not a cron expression",
    widget: { endpoint: "e", dataUpdateDisplay: "x" },
  },
  {
    label: "An `mcp_tool` argument names no parameter",
    widget: {
      endpoint: "e",
      mcp_tool: { mcp_server: "s", tool_id: "t", args: { k: "$b" } },
    },
  },
  {
    label: "A header parameter has the name of a credential header of the connection",
    widget: { endpoint: "e", params: [text("X-Key", { in: "header" })] },
    context: { credentialHeaders: ["X-Key"] },
  },
  {
    label:
      "A query parameter has the name of a credential query value of the connection",
    widget: { endpoint: "e", params: [text("key")] },
    context: { credentialQuery: ["key"] },
  },
];

const rowCases: { label: string; response: unknown; rawDataKey?: string }[] = [
  {
    label: "The path names a field of the response",
    response: { results: { records: [1] } },
    rawDataKey: "results.records",
  },
  {
    label: "The path names nothing in the response",
    response: { results: [1] },
    rawDataKey: "missing",
  },
  {
    label: "No path, and the response has `results`",
    response: { results: [1], other: 2 },
  },
  { label: "No path, and `results` is null", response: { results: null } },
  { label: "No path, and the response has no `results`", response: { other: 2 } },
  { label: "No path, and the response is a list", response: [1, 2] },
];

const SOURCE = "<backend>";
const link = (
  args?: Record<string, unknown>,
  server = "<server>",
  tool = "<tool>",
) => ({
  sourceId: SOURCE,
  params: [{ paramName: "<param>" }, { paramName: "<other param>" }],
  mcp_tool: { mcp_server: server, tool_id: tool, ...(args ? { args } : {}) },
});
const server = (over: Record<string, unknown> = {}) =>
  ({
    id: "<server id>",
    sourceId: SOURCE,
    declaredName: "<server>",
    ...over,
  }) as unknown as McpServer;
const tools = [
  { server_id: "<server id>", name: "<tool>", tool_name: "<tool>" },
] as AgentToolConfig[];

describe("the widget protocol reference", () => {
  const contract = contractCases.map(({ label, widget, context }) => ({
    label,
    messages: contractProblems(widget, context).map((problem) => problem.message),
  }));
  const rows = rowCases.map(({ label, response, rawDataKey }) => ({
    label,
    response: JSON.stringify(response),
    rawDataKey: rawDataKey ?? null,
    rows: JSON.stringify(rowsOf(response, rawDataKey)),
  }));
  const activeCases: {
    label: string;
    widget?: unknown;
    servers: McpServer[];
    tools: AgentToolConfig[];
  }[] = [
    {
      label: "The server and the tool are available",
      widget: link({ "<argument>": "$<param>" }),
      servers: [server()],
      tools,
    },
    {
      label: "The widget has no `mcp_tool`",
      widget: { sourceId: SOURCE },
      servers: [server()],
      tools,
    },
    {
      label: "The server was registered for another backend",
      widget: link(),
      servers: [server({ sourceId: "<other backend>" })],
      tools,
    },
    {
      label: "The server's declared name differs from `mcp_server`",
      widget: link(),
      servers: [server({ declaredName: "<other server>" })],
      tools,
    },
    {
      label: "The tool is not in the request's tool list",
      widget: link(),
      servers: [server()],
      tools: [],
    },
  ];
  const active = activeCases.map(({ label, widget, servers, tools: list }) => ({
    label,
    link: JSON.stringify((widget as { mcp_tool?: unknown }).mcp_tool ?? null),
    result: JSON.stringify(activeMcpLink(widget as never, list, servers) ?? null),
  }));
  const several = [
    { ...link({ "<argument>": "$<param>" }), name: "first" },
    { ...link({ "<argument>": "$<param>", "<literal>": "<value>" }), name: "second" },
  ];
  const citeCases: {
    label: string;
    call: Record<string, unknown>;
    widgets: unknown[];
    server?: McpServer;
  }[] = [
    {
      label: "The mapping is applied in reverse",
      call: { "<argument>": "<value>" },
      widgets: [link({ "<argument>": "$<param>" })],
    },
    {
      label: "An argument that maps to no parameter goes into `details`",
      call: { "<argument>": "<value>", "<extra>": "<value>" },
      widgets: [link({ "<argument>": "$<param>" })],
    },
    {
      label: "Without `args`, an argument named like a parameter fills it",
      call: { "<param>": "<value>", "<extra>": "<value>" },
      widgets: [link()],
    },
    {
      label: "A literal argument that the call does not carry rules the widget out",
      call: { "<argument>": "<value>" },
      widgets: [link({ "<argument>": "$<param>", "<literal>": "<value>" })],
    },
    {
      label: "Several widgets match: the one with the most literal arguments wins",
      call: { "<argument>": "<value>", "<literal>": "<value>" },
      widgets: several,
    },
    {
      label: "The server was registered for another backend",
      call: { "<argument>": "<value>" },
      widgets: [link({ "<argument>": "$<param>" })],
      server: server({ sourceId: "<other backend>" }),
    },
  ];
  const cite = citeCases.map(({ label, call, widgets, server: chosen }) => {
    const found = citeMcpCall(chosen ?? server(), "<tool>", call, widgets as never[]);
    return {
      label,
      call: JSON.stringify(call),
      cited:
        found === null
          ? null
          : ((found.widget as { name?: string }).name ?? "the widget"),
      inputArgs: found === null ? null : JSON.stringify(found.inputArgs),
      details: found === null ? null : JSON.stringify(found.details),
    };
  });

  it("finds a message for every check", () => {
    expect(contract.filter((entry) => entry.messages.length === 0)).toEqual([]);
  });

  it("writes the reference data", () => {
    expect(rows.length).toBe(rowCases.length);
    expect(active.length).toBe(activeCases.length);
    if (OUT === "") return;
    mkdirSync(resolve(OUT), { recursive: true });
    const write = (name: string, data: unknown) =>
      writeFileSync(resolve(OUT, name), `${JSON.stringify(data, null, 2)}\n`);
    write("widgets-contract-reference.json", { checks: contract });
    write("raw-rows-reference.json", { rows });
    write("mcp-link-reference.json", { active, cite });
  });
});
