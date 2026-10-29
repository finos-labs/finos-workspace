import { describe, test } from "node:test";
import { expect } from "expect";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { WorkspaceCommand, WorkspaceCommandResult } from "../../src/bridge/wire.ts";
import { registerWidgetsSchemaResource, WIDGETS_JSON_SCHEMA_URI } from "../../src/resources/widgets-schema.ts";

type Read = () => Promise<{ contents: { uri: string; mimeType: string; text: string }[] }>;

function register(session: string | null, answer: (command: WorkspaceCommand) => WorkspaceCommandResult) {
  const registered: { name: string; uri: string; meta: Record<string, unknown>; read: Read }[] = [];
  const sent: WorkspaceCommand[] = [];
  const mcp = {
    registerResource: (name: string, uri: string, meta: Record<string, unknown>, read: Read) =>
      registered.push({ name, uri, meta, read }),
  } as unknown as McpServer;
  registerWidgetsSchemaResource(mcp, {
    getFirstConnectedSessionId: () => session,
    executeCommand: async (_sessionId: string, command: WorkspaceCommand) => {
      sent.push(command);
      return answer(command);
    },
  } as never);
  return { resource: registered[0], sent };
}

const ok = (data: unknown): WorkspaceCommandResult => ({
  ok: true,
  command: "get_widgets_schema",
  message: "ok",
  data,
  warnings: [],
});

describe("widgets.json schema resource", () => {
  test("serves the browser's composed schema as JSON Schema", async () => {
    const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" };
    const { resource, sent } = register("s-1", () => ok({ schema }));
    expect(resource.uri).toBe(WIDGETS_JSON_SCHEMA_URI);
    expect(resource.meta.mimeType).toBe("application/schema+json");
    const { contents } = await resource.read();
    expect(sent).toEqual([{ command: "get_widgets_schema" }]);
    expect(contents).toEqual([
      { uri: WIDGETS_JSON_SCHEMA_URI, mimeType: "application/schema+json", text: JSON.stringify(schema) },
    ]);
  });

  test("fails with the bridge's message when no browser is connected or the browser refuses", async () => {
    const none = register(null, () => ok({}));
    await expect(none.resource.read()).rejects.toThrow("No connected FINOS Workspace browser");
    expect(none.sent).toEqual([]);

    const refused = register("s-1", () => ({
      ok: false,
      command: "get_widgets_schema",
      message: "The schema could not be composed",
      warnings: [],
    }));
    await expect(refused.resource.read()).rejects.toThrow("The schema could not be composed");
  });
});
