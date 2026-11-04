import type { Trace } from "../trace.ts";
import type { GraderSpec } from "./index.ts";

function firstToolCallIndex(events: Trace["events"]): number {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.event === "copilotFunctionCall") return i;
    if (e.event === "copilotStatusUpdate") {
      const data = e.data as {
        tool_call?: { tool_name?: string };
        details?: Array<{ tool_name?: string }> | { tool_name?: string };
      };
      if (data.tool_call?.tool_name) return i;
      const details = Array.isArray(data.details)
        ? data.details
        : data.details
          ? [data.details]
          : [];
      if (details.some((d) => d?.tool_name)) return i;
    }
  }
  return -1;
}

function firstVisibleChunkIndex(events: Trace["events"]): number {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (
      e.event === "copilotMessageChunk" &&
      ((e.data as { delta?: string }).delta ?? "").trim().length > 0
    ) {
      return i;
    }
  }
  return -1;
}

export function noPreambleLeak(): GraderSpec {
  return {
    name: "noPreambleLeak",
    grader: (trace: Trace) => {
      const tool = firstToolCallIndex(trace.events);
      if (tool < 0) return { pass: true, message: "no tool call — no preamble possible" };
      const chunk = firstVisibleChunkIndex(trace.events);
      if (chunk >= 0 && chunk < tool) {
        const leaked = (trace.events[chunk].data as { delta?: string }).delta ?? "";
        return {
          pass: false,
          message: `visible prose streamed before the first tool call: ${JSON.stringify(leaked.slice(0, 80))}`,
        };
      }
      return { pass: true, message: "no pre-tool prose" };
    },
  };
}
