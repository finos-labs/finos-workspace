import type { EvalCase } from "../runner.ts";
import { macroWorkspace, techWorkspace } from "../fixtures/workspaces.ts";
import { llmJudge, noBadState, toolCalled } from "../graders/index.ts";

export const localeCases: EvalCase[] = [
  {
    id: "timezone-aware-recent-data",
    description:
      "User in Lisbon asks for the latest US macro data → agent grounds its answer in one of the macro widgets (CPI/GDP/unemployment)",
    timezone: "Europe/Lisbon",
    messages: [
      {
        role: "human",
        content:
          "I'm in Lisbon. What was the most recent US economic data release?",
      },
    ],
    workspace: macroWorkspace,
    trials: 3,
    passRate: 0.5,
    graders: [
      llmJudge({
        criterion:
          "The agent grounded its answer in one of the macro widgets (us-cpi, us-gdp, or us-unemployment) — by fetching it OR by referencing it in its narration. Bonus credit if it acknowledged the user is in Lisbon.",
        threshold: 0.5,
      }),
      noBadState(),
    ],
  },
  {
    id: "ambiguous-best-stock-uses-tools",
    description:
      "Ambiguous superlative — model should not hallucinate; either ask, search, or fetch concrete widget data",
    messages: [
      { role: "human", content: "which is the best tech stock?" },
    ],
    workspace: techWorkspace,
    trials: 3,
    passRate: 0.6,
    graders: [
      llmJudge({
        criterion:
          "The agent did NOT confidently name a single 'best' stock without backing data. Either it called search_widgets/get_widget_data to ground its answer, or it asked a clarifying question about the user's criteria.",
        threshold: 0.6,
      }),
      noBadState(),
    ],
  },
];

void toolCalled;
