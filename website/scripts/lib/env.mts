import { pathToFileURL } from "node:url";
import type { AgentEnvVariable, EnvData } from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";

const REGISTRY = "agent/src/lib/env-reference.ts";

export async function collectEnv(): Promise<EnvData> {
  const registry = (await import(pathToFileURL(fromRepo(REGISTRY)).href)) as {
    ENV_REFERENCE: readonly AgentEnvVariable[];
  };
  const agent = registry.ENV_REFERENCE.map((entry) => ({ ...entry }));
  for (const entry of agent) {
    if (entry.description.trim() === "") throw new Error(`The variable ${entry.name} has no description in ${REGISTRY}`);
  }
  return { agent };
}
