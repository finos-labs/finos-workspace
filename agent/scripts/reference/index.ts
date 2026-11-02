import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentsFileReference, collectAgentsFile } from "./agents.ts";
import { collectMcp, type McpReference } from "./mcp.ts";
import { collectMetrics, type MetricEntry } from "./metrics.ts";
import { collectProtocol, type ProtocolReference } from "./protocol.ts";
import { collectRoutes, type RoutesReference } from "./routes.ts";
import { buildOpenApiDocument } from "../../src/lib/openapi.ts";
import { ROUTE_DEFINITIONS, ROUTE_TAGS } from "../../src/routes/definitions.ts";

export const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), "../../reference-data/reference.json");
export const OPENAPI_OUTPUT = join(dirname(fileURLToPath(import.meta.url)), "../../reference-data/openapi.json");

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

/** The OpenAPI document that describes the routes that the agent serves. */
export function renderOpenApi(): string {
  const document = buildOpenApiDocument(
    ROUTE_DEFINITIONS,
    {
      title: "Agent HTTP API",
      version: "1.0.0",
      description: "The routes that the agent serves. The definitions sit next to the handlers in agent/src/routes/.",
    },
    ROUTE_TAGS,
  );
  return `${JSON.stringify(document, null, 2)}\n`;
}
