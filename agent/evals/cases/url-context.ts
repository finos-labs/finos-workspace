import type { EvalCase } from "../runner.ts";
import { noBadState, toolCalled } from "../graders/index.ts";

const CONTEXT_TABLE_ROWS = [
  { quarter: "Q1", revenue: 100 },
  { quarter: "Q2", revenue: 200 },
  { quarter: "Q3", revenue: 150 },
  { quarter: "Q4", revenue: 250 },
];

export const urlContextCases: EvalCase[] = [
  {
    id: "context-structured-rows-route-to-sql",
    description:
      "request.context carries a structured table from a prior chat artifact. The model should run execute_sql against the synthetic ctx_* table, not refetch anything.",
    messages: [
      {
        role: "human",
        content:
          "Using the revenue table I attached, which quarter is biggest?",
      },
    ],
    workspace: { primary: [], secondary: [], extra: [] },
    context: [
      {
        uuid: "ctx-1",
        name: "revenue_by_quarter",
        description: "Quarterly revenue from prior chat artifact",
        data: {
          items: [
            {
              content: JSON.stringify(CONTEXT_TABLE_ROWS),
              data_format: { parse_as: "table" },
            },
          ],
        },
      },
    ],
    trials: 3,
    passRate: 0.5,
    graders: [
      toolCalled("execute_sql"),
      noBadState(),
    ],
  },
];
