import type { Trace } from "../trace.ts";
import type { GraderSpec } from "./index.ts";

export function toolCalled(name: string): GraderSpec {
  return {
    name: `toolCalled(${name})`,
    grader: (trace: Trace) => {
      const matched = trace.toolCalls.find(
        (c) => c.name === name || c.serverToolName === name,
      );
      return matched
        ? { pass: true, message: `${name} called` }
        : {
            pass: false,
            message: `${name} not called. Saw: ${trace.toolCalls.map((c) => c.serverToolName ?? c.name).join(", ") || "(none)"}`,
          };
    },
  };
}

export function toolNeverCalled(name: string): GraderSpec {
  return {
    name: `toolNeverCalled(${name})`,
    grader: (trace: Trace) => {
      const matched = trace.toolCalls.find(
        (c) => c.name === name || c.serverToolName === name,
      );
      return matched
        ? { pass: false, message: `${name} was called but should not have been` }
        : { pass: true, message: `${name} not called (as expected)` };
    },
  };
}
