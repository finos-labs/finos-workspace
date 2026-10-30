import { agentsRouter } from "../../src/routes/agents.ts";

const PLACEHOLDER = "<provider>:<model>";
const PROBES = ["DEFAULT_MODEL", "INES_MODELS", "INES_TRANSCRIBE_MODEL"] as const;

type Descriptor = Record<string, { features?: Record<string, unknown> }>;

export interface AgentsFileReference {
  file: Descriptor;
  conditional: { feature: string; variable: string }[];
}

async function descriptor(set: readonly string[]): Promise<Descriptor> {
  const saved = new Map(PROBES.map((name) => [name, process.env[name]]));
  for (const name of PROBES) delete process.env[name];
  for (const name of set) process.env[name] = PLACEHOLDER;
  try {
    const response = await agentsRouter.request("/agents.json");
    return (await response.json()) as Descriptor;
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function featureKeys(file: Descriptor): string[] {
  return Object.values(file).flatMap((agent) => Object.keys(agent.features ?? {}));
}

export async function collectAgentsFile(): Promise<AgentsFileReference> {
  const bare = new Set(featureKeys(await descriptor([])));
  const conditional: AgentsFileReference["conditional"] = [];
  for (const variable of PROBES) {
    for (const feature of featureKeys(await descriptor([variable]))) {
      if (!bare.has(feature)) conditional.push({ feature, variable });
    }
  }
  return { file: await descriptor(PROBES), conditional };
}
