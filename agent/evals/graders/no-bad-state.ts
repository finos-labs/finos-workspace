import type { Trace } from "../trace.ts";
import type { GraderSpec } from "./index.ts";

export function noBadState(): GraderSpec {
  return {
    name: "noBadState",
    grader: (trace: Trace) => {
      const blob = trace.finalText;

      if (blob.includes("x-agent-")) {
        return {
          pass: false,
          message: "Model leaked x-agent-* into the final text",
        };
      }

      if (trace.errored) {
        return {
          pass: false,
          message: `Loop errored: ${trace.errorMessage ?? "unknown"}`,
        };
      }

      return { pass: true, message: "no invariants violated" };
    },
  };
}
