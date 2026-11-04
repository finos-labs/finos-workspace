import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer, CORS_ALLOW_HEADERS, createMcpApp, TOOLS, type ToolGroup } from "../../mcp-server/src/app.ts";
import { jsonSchemaFields, type SchemaField } from "./json-schema.ts";

const ROUTE_SUMMARIES: Record<string, string> = {
  "POST /mcp": "The MCP endpoint, served over streamable HTTP. Every request gets a new server instance.",
  "GET /mcp": "Answers 405 with a JSON-RPC error whose message is \"Method not allowed.\".",
  "DELETE /mcp": "Answers 405 with a JSON-RPC error whose message is \"Method not allowed.\".",
  "GET /": "A JSON description of the server: its name, the endpoint, the registered tools, the prompts, the resources and the routes of the bridge.",
  "POST /bridge/session/start": "Starts a bridge session for a Workspace tab, in companion mode.",
  "GET /bridge/ws": "The WebSocket that a Workspace tab keeps open to receive commands, in companion mode.",
  "GET /bridge/health": "The state of the bridge: its sessions.",
};

const AVAILABILITY: Record<ToolGroup, string> = {
  backend: "Always.",
  documents: "When document search is set up.",
  workspace: "In companion mode.",
};

export interface McpToolEntry {
  name: string;
  group: ToolGroup;
  availability: string;
  scoped: boolean;
  description: string;
  fields: SchemaField[];
}

export interface McpReference {
  corsHeaders: string[];
  routes: { method: string; path: string; summary: string }[];
  tools: McpToolEntry[];
  prompts: { name: string; description: string }[];
  resources: { uri: string; name: string; description: string; mimeType: string }[];
}

export async function collectMcp(): Promise<McpReference> {
  const features = { documents: true, companion: true };
  const server = await buildMcpServer(features);
  const client = new Client({ name: "reference", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const [tools, prompts, resources] = await Promise.all([client.listTools(), client.listPrompts(), client.listResources()]);
  await client.close();

  const served = new Map(tools.tools.map((item) => [item.name, item]));
  const toolEntries = TOOLS.map((entry): McpToolEntry => {
    const item = served.get(entry.name);
    if (!item) throw new Error(`The server does not serve the tool ${entry.name}`);
    return {
      name: entry.name,
      group: entry.group,
      availability: AVAILABILITY[entry.group],
      scoped: entry.scoped,
      description: item.description ?? "",
      fields: jsonSchemaFields(item.inputSchema),
    };
  });
  const unlisted = tools.tools.filter((item) => !TOOLS.some((entry) => entry.name === item.name));
  if (unlisted.length > 0) throw new Error(`The server serves tools that TOOLS lacks: ${unlisted.map((item) => item.name).join(", ")}`);

  const app = createMcpApp(features);
  const routes = app.routes
    .filter((route) => route.method !== "ALL")
    .map((route) => {
      const key = `${route.method} ${route.path}`;
      const summary = ROUTE_SUMMARIES[key];
      if (summary === undefined) throw new Error(`The MCP route ${key} has no summary in ROUTE_SUMMARIES`);
      return { method: route.method, path: route.path, summary };
    });
  const served_ = new Set(routes.map((route) => `${route.method} ${route.path}`));
  for (const key of Object.keys(ROUTE_SUMMARIES)) {
    if (!served_.has(key)) throw new Error(`ROUTE_SUMMARIES has ${key}, which the MCP server does not serve`);
  }

  return {
    corsHeaders: CORS_ALLOW_HEADERS,
    routes,
    tools: toolEntries,
    prompts: prompts.prompts.map((item) => ({ name: item.name, description: item.description ?? "" })),
    resources: resources.resources.map((item) => ({
      uri: item.uri,
      name: item.name,
      description: item.description ?? "",
      mimeType: item.mimeType ?? "",
    })),
  };
}
