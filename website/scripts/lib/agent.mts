import type { AgentData, ApiData } from "../../src/data/types.ts";
import { collectOpenApi } from "./openapi.mts";
import { readReference } from "./reference.mts";

export function collectAgent(): AgentData {
  return readReference("agent", "reference.json") as AgentData;
}

/** The routes that the agent serves, from the OpenAPI document that the agent writes. */
export function collectAgentApi(): ApiData {
  const spec = readReference("agent", "openapi.json");
  const { tags, schemas } = collectOpenApi(spec, { source: "agent openapi.json" });
  return { tags, schemas, metrics: [] };
}
