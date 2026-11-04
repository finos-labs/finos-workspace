import type { AgentsJsonData, SchemaDoc } from "../../src/data/types.ts";
import { readReference, referencePath } from "./reference.mts";
import { describeSchema } from "./schema.mts";

type Json = Record<string, unknown>;

interface FrontendAgents {
  schema: Json;
  features: Record<string, string>;
}

interface AgentReference {
  agentsFile: { file: unknown; conditional: { feature: string; variable: string }[] };
}

function settingSchema(schema: Json): Json {
  const features = (schema.properties as Record<string, Json>).features as Json;
  const alternatives = (features.additionalProperties as Json).anyOf as Json[];
  const found = alternatives.find((item) => item.type === "object");
  if (found === undefined) throw new Error("The agents schema has no object for a feature setting");
  return found;
}

export function collectAgentsJson(): AgentsJsonData {
  const frontend = readReference("frontend", "agents-reference.json") as FrontendAgents;
  const agent = readReference("agent", "reference.json") as unknown as AgentReference;
  const docs: SchemaDoc[] = [
    describeSchema("Agent", frontend.schema),
    describeSchema("Feature setting", settingSchema(frontend.schema)),
  ];
  return {
    schema: { source: referencePath("frontend", "agents-reference.json"), title: "agents.json", definitions: docs },
    features: Object.entries(frontend.features).map(([key, description]) => ({ key, description })),
    file: agent.agentsFile.file,
    conditional: agent.agentsFile.conditional,
  };
}
