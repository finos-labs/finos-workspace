import type { AgentData } from "../../src/data/types.ts";
import { readReference } from "./reference.mts";

export function collectAgent(): AgentData {
  return readReference("agent", "reference.json") as AgentData;
}
