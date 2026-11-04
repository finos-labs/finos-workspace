import type { EvalCase } from "../runner.ts";
import { techWorkspace } from "../fixtures/workspaces.ts";
import { noPreambleLeak, noBadState, toolCalled } from "../graders/index.ts";

export const streamingCases: EvalCase[] = [
  {
    id: "no-preamble-before-tool",
    description:
      "Model must not stream prose before its first tool call (live-stream regression guard)",
    messages: [
      {
        role: "human",
        content: "What's the latest revenue for the companies on my dashboard?",
      },
    ],
    workspace: techWorkspace,
    trials: 5,
    passRate: 0.9,
    graders: [noPreambleLeak(), noBadState()],
  },
  {
    id: "suggest-followups-call-rate",
    description:
      "SPIKE: how often the model calls suggest_followups when instructed (suggestionsVia=tool). observedRate = call-rate.",
    messages: [
      {
        role: "human",
        content: "In one or two sentences, what is a P/E ratio and why does it matter?",
      },
    ],
    workspace: techWorkspace,
    promptSuggestionsEnabled: true,
    suggestionsVia: "tool",
    trials: 5,
    passRate: 0.2,
    graders: [toolCalled("suggest_followups"), noBadState()],
  },
];
