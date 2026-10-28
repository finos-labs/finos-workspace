import type { Trace } from "../trace.ts";
import type { GraderSpec } from "./index.ts";
import type { SSEEvent } from "../../src/protocol/types.ts";

interface ExtraStateShape {
  intermediate_citations?: Array<{ id?: string }>;
}

interface CallShape {
  function: string;
  extra_state?: ExtraStateShape;
}

export function intermediateCitationContains(id: string): GraderSpec {
  return {
    name: `intermediateCitationContains(${id})`,
    grader: (trace: Trace) => {
      for (const event of trace.events as SSEEvent[]) {
        if (event.event !== "copilotFunctionCall") continue;
        const data = event.data as unknown as CallShape;
        const cits = data.extra_state?.intermediate_citations ?? [];
        if (cits.some((c) => c.id === id)) {
          return {
            pass: true,
            message: `${data.function} extra_state.intermediate_citations contains "${id}"`,
          };
        }
      }
      for (const event of trace.events as SSEEvent[]) {
        if (event.event !== "copilotCitationCollection") continue;
        const cits = (event.data as { citations?: Array<{ id?: string }> }).citations ?? [];
        if (cits.some((c) => c.id === id)) {
          return {
            pass: true,
            message: `terminal citationCollection contains "${id}"`,
          };
        }
      }
      return {
        pass: false,
        message: `no emit carried citation "${id}" — re-POST plumbing dropped it`,
      };
    },
  };
}
