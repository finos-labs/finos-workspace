import type { EvalCase } from "../runner.ts";
import type { GraderSpec } from "../graders/index.ts";
import { noBadState, toolCalled } from "../graders/index.ts";
import { techWorkspace } from "../fixtures/workspaces.ts";

const VALID_WIDGET_IDS = new Set(techWorkspace.primary.map((w) => w.widget_id));

const appWidgetRefsValid: GraderSpec = {
  name: "create_app refs in workspace (no hallucinated widget ids)",
  grader: (trace) => {
    const call = trace.toolCalls.find((c) => c.name === "create_app");
    if (!call) return { pass: false, message: "create_app not called" };
    const tabs =
      (call.parameters as { tabs?: { layout?: { widget_id?: string }[] }[] }).tabs ?? [];
    const refs = tabs.flatMap((t) => (t.layout ?? []).map((l) => l.widget_id ?? ""));
    if (refs.length === 0) return { pass: false, message: "create_app had no widget refs" };
    const invalid = refs.filter((id) => !VALID_WIDGET_IDS.has(id));
    return invalid.length === 0
      ? { pass: true, message: `all ${refs.length} widget refs are real` }
      : { pass: false, message: `invented widget ids: ${[...new Set(invalid)].join(", ")}` };
  },
};

export const appBuilderCases: EvalCase[] = [
  {
    id: "build-dashboard-uses-real-widgets",
    description:
      "User asks to build an Apple dashboard. The model should discover widgets via " +
      "search_widgets and assemble them with create_app using only real (origin, widget_id) pairs.",
    messages: [
      {
        role: "human",
        content:
          "Build me an Apple dashboard with the price history, earnings, and news side by side.",
      },
    ],
    workspace: techWorkspace,
    trials: 5,
    passRate: 0.6,
    graders: [
      toolCalled("search_widgets"),
      toolCalled("create_app"),
      appWidgetRefsValid,
      noBadState(),
    ],
  },
];
