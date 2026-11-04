import type { Trace } from "../trace.ts";
import type { GraderSpec } from "./index.ts";

export function argContains(name: string, terms: string[]): GraderSpec {
  return {
    name: `argContains(${name}, [${terms.join(", ")}])`,
    grader: (trace: Trace) => {
      const matches = trace.toolCalls.filter(
        (c) => c.name === name || c.serverToolName === name,
      );
      if (matches.length === 0) {
        return { pass: false, message: `${name} not called` };
      }
      for (const match of matches) {
        const blob = JSON.stringify(match.parameters).toLowerCase();
        const missing = terms.filter((t) => !blob.includes(t.toLowerCase()));
        if (missing.length === 0) {
          return { pass: true, message: `${name} args contain all terms` };
        }
      }
      return {
        pass: false,
        message: `${name} args missing terms: ${terms.join(", ")}`,
      };
    },
  };
}
