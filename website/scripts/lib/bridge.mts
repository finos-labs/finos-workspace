import { readFileSync } from "node:fs";
import { jsonSchemaFields } from "../../../agent/scripts/reference/json-schema.ts";
import type { BridgeData, PluginValueType, ProtocolMessage } from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";

type Json = Record<string, any>;

const BACKEND = "backend-api/backend/tests/fixtures/workspace_bridge.json";
const FRONTEND = "frontend/tests/fixtures/workspace-bridge-reference.json";

function readJson(path: string): Json {
  return JSON.parse(readFileSync(fromRepo(path), "utf8")) as Json;
}

function messages(entries: Json[]): ProtocolMessage[] {
  return entries.map((entry) => {
    const description = (entry.meaning as string).trim();
    if (description === "") throw new Error(`The bridge message ${entry.type} has no description`);
    return {
      t: entry.type as string,
      description,
      fields: jsonSchemaFields(entry.schema as object).filter((field) => field.path !== "type"),
    };
  });
}

export function collectBridge(): BridgeData {
  const backend = readJson(BACKEND);
  const frontend = readJson(FRONTEND);
  const values: Record<string, PluginValueType> = {};
  for (const [key, value] of Object.entries(backend.constants as Json)) {
    if (typeof value === "number" || typeof value === "string") values[`constants.${key}`] = value;
  }
  for (const [key, value] of Object.entries(frontend.limits as Json)) values[`limits.${key}`] = value as number;
  const sent = (backend.commands as Json[]).map((command) => command.name as string);
  values["counts.sent"] = sent.length;
  values["counts.accepted"] = (frontend.commands as string[]).length;
  return {
    errorCodes: backend.errorCodes as string[],
    agentOnlyCommands: (frontend.commands as string[]).filter((name) => !sent.includes(name)),
    commands: (backend.commands as Json[]).map((command) => ({
      name: command.name as string,
      tool: (command.tool as string | null) ?? null,
      meaning: command.meaning as string,
      fields: jsonSchemaFields(command.schema as object).filter((field) => field.path !== "command" && field.path !== "request_id"),
    })),
    toTab: messages(backend.toTab as Json[]),
    toApi: messages(backend.toApi as Json[]),
    result: jsonSchemaFields(backend.result as object),
    values,
  };
}
