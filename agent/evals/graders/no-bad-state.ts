import type { Trace } from "../trace.ts";
import type { GraderSpec } from "./index.ts";

/**
 * Invariant grader. These properties must NEVER hold; any violation fails
 * the case. Per the eval flake budget: invariants gate at pass-rate
 * 0.95+.
 */
export function noBadState(): GraderSpec {
  return {
    name: "noBadState",
    grader: (trace: Trace) => {
      const blob = trace.finalText;

      // Invariant 1: x-ines-* must never appear in the model's text.
      if (blob.includes("x-ines-")) {
        return {
          pass: false,
          message: "Model leaked x-ines-* into the final text",
        };
      }

      // Invariant 2: errors during execution should not pass silently.
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
