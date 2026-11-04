import type { Trace } from "../trace.ts";

export interface GradeResult {
  pass: boolean;
  message: string;
}

type Grader = (trace: Trace) => GradeResult | Promise<GradeResult>;

export interface GraderSpec {
  name: string;
  grader: Grader;
}

export { toolCalled, toolNeverCalled } from "./tool-called.ts";
export { argContains } from "./arg-contains.ts";
export { widgetIdInTopN } from "./widget-rank.ts";
export { noBadState } from "./no-bad-state.ts";
export { noPreambleLeak } from "./no-preamble-leak.ts";
export { llmJudge } from "./llm-judge.ts";
export { intermediateCitationContains } from "./citations-persisted.ts";
