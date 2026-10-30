import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentsFileReference, collectAgentsFile } from "./agents.ts";
import { collectMcp, type McpReference } from "./mcp.ts";
import { collectMetrics, type MetricEntry } from "./metrics.ts";
import { collectProtocol, type ProtocolReference } from "./protocol.ts";
import { collectRoutes, type RoutesReference } from "./routes.ts";

export const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), "../../reference-data/reference.json");

export interface Reference {
  http: RoutesReference;
  metrics: MetricEntry[];
  mcp: McpReference;
  protocol: ProtocolReference;
  agentsFile: AgentsFileReference;
}

export async function collectReference(): Promise<Reference> {
  return {
    http: collectRoutes(),
    metrics: collectMetrics(),
    mcp: await collectMcp(),
    protocol: collectProtocol(),
    agentsFile: await collectAgentsFile(),
  };
}

export async function renderReference(): Promise<string> {
  return `${JSON.stringify(await collectReference(), null, 2)}\n`;
}
