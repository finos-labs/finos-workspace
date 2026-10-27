import { readFileSync } from "node:fs";
import type {
  ApiData,
  ApiOperation,
  CliCommand,
  CliData,
  DatabaseData,
  McpData,
  SchemaSet,
  SettingsData,
} from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";
import { describeSchema, describeSet, typeLabel } from "./schema.mts";

type Json = Record<string, any>;

const FIXTURES = "backend-api/backend/tests/fixtures";
const METHODS = ["get", "post", "put", "patch", "delete"];

function readJson(path: string): Json {
  return JSON.parse(readFileSync(fromRepo(path), "utf8")) as Json;
}

export function collectApi(): ApiData {
  const spec = readJson(`${FIXTURES}/openapi.json`);
  const byTag = new Map<string, ApiOperation[]>();
  for (const path of Object.keys(spec.paths).sort()) {
    const item = spec.paths[path] as Json;
    for (const method of METHODS) {
      const operation = item[method] as Json | undefined;
      if (operation === undefined) continue;
      const tag = (operation.tags?.[0] as string | undefined) ?? "service";
      const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map((parameter: Json) => ({
        name: parameter.name as string,
        in: parameter.in as string,
        required: parameter.required === true,
        type: typeLabel(parameter.schema),
        description: parameter.description as string | undefined,
      }));
      const entry: ApiOperation = {
        method: method.toUpperCase(),
        path,
        tag,
        summary: (operation.summary as string | undefined) ?? "",
        parameters,
        responses: Object.entries((operation.responses ?? {}) as Json).map(([code, response]: [string, Json]) => {
          const content = response.content ? (Object.values(response.content)[0] as Json) : undefined;
          return {
            code,
            description: (response.description as string | undefined) ?? "",
            schema: content ? typeLabel(content.schema) : undefined,
          };
        }),
      };
      if (operation.requestBody) {
        const [contentType, content] = Object.entries(operation.requestBody.content as Json)[0] as [string, Json];
        entry.requestBody = {
          contentType,
          required: operation.requestBody.required === true,
          schema: typeLabel(content.schema),
        };
      }
      if (!byTag.has(tag)) byTag.set(tag, []);
      (byTag.get(tag) as ApiOperation[]).push(entry);
    }
  }
  const schemas = (spec.components?.schemas ?? {}) as Json;
  return {
    tags: [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, operations]) => ({ name, operations })),
    schemas: Object.keys(schemas)
      .sort()
      .map((name) => describeSchema(name, schemas[name])),
  };
}

export function collectWidgetsSchema(): SchemaSet {
  return describeSet(`${FIXTURES}/widgets_schema.json`, "widgets.json", readJson(`${FIXTURES}/widgets_schema.json`), "definitions");
}

export function collectAppsSchema(): SchemaSet {
  return describeSet("frontend/apps-schema.json", "apps.json", readJson("frontend/apps-schema.json"), "definitions");
}

export function collectManifestSchema(): SchemaSet {
  return describeSet(
    `${FIXTURES}/plugin_manifest_schema.json`,
    "plugin.json",
    readJson(`${FIXTURES}/plugin_manifest_schema.json`),
    "$defs",
  );
}

export function collectSettings(): SettingsData {
  const source = readJson(`${FIXTURES}/settings.json`);
  return {
    constants: source.constants as Record<string, number | string>,
    fields: (source.fields as Json[]).map((field) => {
      const name = field.name as string;
      const description = (field.description as string).trim();
      if (description === "") throw new Error(`The setting ${name} has no description in settings.json`);
      return {
        name,
        group: field.group as string,
        type: field.type as string,
        required: field.required === true,
        default: field.default,
        hasDefaultFactory: field.has_default_factory === true,
        description,
        choices: (field.choices as string[] | null) ?? null,
      };
    }),
  };
}

export function collectDatabase(): DatabaseData {
  const source = readJson(`${FIXTURES}/database_schema.json`);
  return {
    tables: (source.tables as Json[]).map((table) => ({
      name: table.name as string,
      columns: (table.columns as Json[]).map((column) => ({
        name: column.name as string,
        type: column.type as string,
        nullable: column.nullable === true,
        primaryKey: column.primary_key === true,
        unique: column.unique === true,
        indexed: column.indexed === true,
        serverDefault: (column.server_default as string | null) ?? null,
        references: (column.references as Json[]).map((reference) => ({
          column: reference.column as string,
          onDelete: (reference.on_delete as string | null) ?? null,
        })),
      })),
      indexes: table.indexes as { name: string | null; columns: string[]; unique: boolean }[],
      uniqueConstraints: table.unique_constraints as { name: string | null; columns: string[] }[],
    })),
  };
}

function mapCommand(command: Json): CliCommand {
  return {
    name: command.name as string,
    prog: command.prog as string,
    help: (command.help as string | null) ?? null,
    description: (command.description as string | null) ?? null,
    arguments: (command.arguments as Json[]).map((argument) => ({
      flags: argument.flags as string[],
      positional: argument.positional === true,
      required: argument.required === true,
      help: (argument.help as string | null) ?? null,
      default: argument.default,
      choices: (argument.choices as string[] | null) ?? null,
      metavar: (argument.metavar as string | null) ?? null,
      multiple: argument.multiple === true,
    })),
    commands: (command.commands as Json[]).map(mapCommand),
  };
}

export function collectCli(): CliData {
  const source = readJson(`${FIXTURES}/admin_cli.json`);
  return {
    prog: source.prog as string,
    description: (source.description as string | null) ?? null,
    commands: (source.commands as Json[]).map(mapCommand),
  };
}

export function collectMcp(): McpData {
  const surface = readJson(`${FIXTURES}/workspace_mcp_sidecar_surface.json`).surface as Json;
  return {
    instructions: surface.instructions as string,
    tools: (surface.tools as Json[]).map((tool) => ({
      name: tool.name as string,
      description: (tool.description as string | null) ?? "",
      parameters: describeSchema(tool.name as string, tool.parameters),
    })),
    resources: (surface.resources as Json[]).map((resource) => ({
      uri: resource.uri as string,
      name: resource.name as string,
      description: (resource.description as string | null) ?? "",
      mimeType: (resource.mime_type as string | null) ?? null,
    })),
    prompts: (surface.prompts as Json[]).map((prompt) => ({
      name: prompt.name as string,
      description: (prompt.description as string | null) ?? "",
      arguments: ((prompt.arguments ?? []) as Json[]).map((argument) => ({
        name: argument.name as string,
        description: (argument.description as string | null) ?? "",
        required: argument.required === true,
      })),
    })),
  };
}
