import type { EvalCase } from "../runner.ts";
import type { ToolMessage } from "../../src/protocol/types.ts";
import { toolCalled, argContains, noBadState } from "../graders/index.ts";

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
              { symbol: "AAPL", date: "2026-04-01", close: 7.13 },
              { symbol: "AAPL", date: "2026-05-01", close: 9.42 },
              { symbol: "NVDA", date: "2026-04-01", close: 11.55 },
              { symbol: "NVDA", date: "2026-05-01", close: 33.21 },
              { symbol: "MSFT", date: "2026-04-01", close: 19.07 },
              { symbol: "MSFT", date: "2026-05-01", close: 24.66 },
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
  description: "Run SQLite SELECT/WITH against widget data already loaded.",
  input_schema: {
    properties: {
      sql: { type: "string" },
    },
    required: ["sql"],
  },
};

export const sqlAnalysisCases: EvalCase[] = [
  {
    id: "compare-three-stock-returns",
    description: "Compare 1-month return for NVDA, AAPL, MSFT after data load",
    messages: [
      { role: "human", content: "compare 1-month returns for NVDA, AAPL, MSFT" },
      PRICES_LOADED,
    ],
    workspace: { primary: [], secondary: [], extra: [] },
    tools: [SQL_TOOL],
    trials: 3,
    passRate: 0.6,
    graders: [
      toolCalled("execute_sql"),
      noBadState(),
    ],
  },
  {
    id: "max-close-by-symbol",
    description: "Highest closing price by symbol after data load",
    messages: [
      { role: "human", content: "what's the highest close for each ticker?" },
      PRICES_LOADED,
    ],
    workspace: { primary: [], secondary: [], extra: [] },
    tools: [SQL_TOOL],
    trials: 3,
    passRate: 0.6,
    graders: [
      toolCalled("execute_sql"),
      argContains("execute_sql", ["max", "close"]),
      noBadState(),
    ],
  },
];
