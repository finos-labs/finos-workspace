/**
 * Graders take a Trace and return a GradeResult. Compose them per case.
 *
 * Per Anthropic's eval guidance: grade END-STATE, not exact tool order.
 * The agent regularly finds valid alternative paths.
 */

import type { Trace } from "../trace.ts";

export interface GradeResult {
  pass: boolean;
  message: string;
}

export type Grader = (trace: Trace) => GradeResult | Promise<GradeResult>;

export interface GraderSpec {
  name: string;
  grader: Grader;
}

export { toolCalled, toolNeverCalled } from "./tool-called.ts";
export { argContains, argEquals } from "./arg-contains.ts";
export { widgetIdInTopN } from "./widget-rank.ts";
export { noBadState } from "./no-bad-state.ts";
export { noPreambleLeak } from "./no-preamble-leak.ts";
export { llmJudge } from "./llm-judge.ts";
export { intermediateCitationContains } from "./citations-persisted.ts";
