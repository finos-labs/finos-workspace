import { readFileSync } from "node:fs";
import type { AgentData } from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";

const FIXTURE = "agent/tests/fixtures/reference.json";

export function collectAgent(): AgentData {
  return JSON.parse(readFileSync(fromRepo(FIXTURE), "utf8")) as AgentData;
}
