import type { EvalCase } from "../runner.ts";
import type { ToolMessage } from "../../src/protocol/types.ts";
import { techWorkspace } from "../fixtures/workspaces.ts";
import {
  intermediateCitationContains,
  noBadState,
} from "../graders/index.ts";

const STASH_ID = "stashed-eval-citation";

const PRIOR_WITH_STASH: ToolMessage = {
  role: "tool",
  function: "execute_agent_tool",
  input_arguments: { tool_name: "fetch_webpage", server_id: "agent" },
  data: [
    {
      items: [
        {
          text: "External page already fetched — content not relevant; the citation is the contract.",
        },
      ],
    },
  ],
  extra_state: {
    intermediate_citations: [
      {
        id: STASH_ID,
        source_info: { type: "web", name: "Earlier source", citable: true },
        details: [{ link: "https://earlier.example", title: "Earlier source" }],
        signature: "",
      },
    ],
  },
};

const FETCH_TOOL = {
  name: "fetch_webpage",
  server_id: "agent",
  url: "http://localhost:8787/mcp",
  description: "Fetch a webpage. Returns body + citation.",
  input_schema: {
    properties: { url: { type: "string" } },
    required: ["url"],
  },
};

const SEARCH_TOOL = {
  name: "web_search",
  server_id: "agent",
  url: "http://localhost:8787/mcp",
  description: "Search the web. Returns links + citations.",
  input_schema: {
    properties: { q: { type: "string" } },
    required: ["q"],
  },
};

export const citationsCases: EvalCase[] = [
  {
    id: "citation-survives-next-emit",
    description:
      "Stashed intermediate citation re-emitted in the next round-trip's extra_state, regardless of tool choice",
    messages: [
      { role: "human", content: "research more — find a follow-up source" },
      PRIOR_WITH_STASH,
    ],
    workspace: techWorkspace,
    tools: [FETCH_TOOL, SEARCH_TOOL],
    trials: 3,
    passRate: 0.66,
    graders: [
      intermediateCitationContains(STASH_ID),
      noBadState(),
    ],
  },
  {
    id: "citation-survives-widget-fetch-path",
    description:
      "Stashed citation re-emitted when prompt nudges the model toward a widget fetch",
    messages: [
      { role: "human", content: "now pull AAPL's price to compare" },
      PRIOR_WITH_STASH,
    ],
    workspace: techWorkspace,
    tools: [],
    trials: 3,
    passRate: 0.5,
    graders: [
      intermediateCitationContains(STASH_ID),
      noBadState(),
    ],
  },
  {
    id: "citation-survives-terminal-answer",
    description:
      "Stashed citation surfaces in terminal citationCollection when no further round-trip is needed",
    messages: [
      { role: "human", content: "summarize the source you already fetched" },
      PRIOR_WITH_STASH,
    ],
    workspace: techWorkspace,
    tools: [FETCH_TOOL],
    trials: 3,
    passRate: 0.5,
    graders: [
      intermediateCitationContains(STASH_ID),
      noBadState(),
    ],
  },
];
