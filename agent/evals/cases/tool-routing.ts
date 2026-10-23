import type { EvalCase } from "../runner.ts";
import type { ToolMessage } from "../../src/protocol/types.ts";
import {
  argContains,
  noBadState,
  toolCalled,
} from "../graders/index.ts";

const PRICES_LOADED: ToolMessage = {
  role: "tool",
  function: "execute_agent_tool",
  input_arguments: {
    tool_name: "load_prices",
    server_id: "fixture",
    parameters: {},
  },
  data: [
    {
      items: [
        {
          text: JSON.stringify({
            $ines_kind: "sqlite_table",
            name: "prices",
            rows: [
              ...Array.from({ length: 60 }, (_, i) => ({
                symbol: "AAPL",
                date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
                close: 3.14 + i * 0.07,
              })),
              ...Array.from({ length: 60 }, (_, i) => ({
                symbol: "NVDA",
                date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
                close: 8.41 + i * 0.13,
              })),
            ],
          }),
        },
      ],
    },
  ],
};

const SQL_TOOL = {
  name: "execute_sql",
  server_id: "ines",
  url: "http://localhost:8787/mcp",
  description:
    "Run SQLite SELECT/WITH against widget data. Use for filters, aggregations, joins. Cheap.",
  input_schema: {
    properties: {
      sql: { type: "string" },
    },
    required: ["sql"],
  },
};

export const toolRoutingCases: EvalCase[] = [
  {
    id: "filter-aggregate-routes-to-sql",
    description: "Simple filter+aggregate → execute_sql",
    messages: [
      { role: "human", content: "what's the average close price for AAPL?" },
      PRICES_LOADED,
    ],
    workspace: { primary: [], secondary: [], extra: [] },
    tools: [SQL_TOOL],
    trials: 3,
    passRate: 0.6,
    graders: [
      toolCalled("execute_sql"),
      argContains("execute_sql", ["AAPL"]),
      noBadState(),
    ],
  },
  {
    id: "join-prefers-sql",
    description: "Find dates where AAPL > NVDA → SQL join is the right tool",
    messages: [
      {
        role: "human",
        content:
          "list dates where AAPL closed higher than NVDA",
      },
      PRICES_LOADED,
    ],
    workspace: { primary: [], secondary: [], extra: [] },
    tools: [SQL_TOOL],
    trials: 3,
    passRate: 0.5,
    graders: [
      toolCalled("execute_sql"),
      noBadState(),
    ],
  },
];
