import { readFileSync } from "node:fs";
import type {
  ApiData,
  ApiMetric,
  ApiOperation,
  CliCommand,
  CliData,
  DatabaseData,
  McpData,
  SchemaSet,
  SettingsData,
} from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";
import { collectOpenApi } from "./openapi.mts";
import { readReference, referencePath } from "./reference.mts";
import { describeCases, describeSchema, describeSet, renameType, typeLabel } from "./schema.mts";

type Json = Record<string, any>;

const SURFACE = "backend-api/backend/tests/fixtures/workspace_mcp_sidecar_surface.json";
const FASTAPI_ERROR_MODELS = new Set(["HTTPValidationError", "ValidationError"]);

function readJson(path: string): Json {
  return JSON.parse(readFileSync(fromRepo(path), "utf8")) as Json;
}

function collectApiMetrics(): ApiMetric[] {
  const source = readReference("backend", "api_metrics.json");
  return [...(source.requests as Json[]), ...(source.runtime as Json[])].map((metric) => {
    const labelValues = (metric.label_values ?? {}) as Record<string, string[]>;
    return {
      name: metric.name as string,
      type: metric.type as string,
      labels: metric.labels as string[],
      labelValues: Object.keys(labelValues).length > 0 ? labelValues : null,
      help: metric.help as string,
    };
  });
}

export function collectApi(): ApiData {
  const spec = readReference("backend", "openapi.json");
  const { tags, schemas } = collectOpenApi(spec, {
    source: "openapi.json",
    skipCodes: ["422"],
    skipSchemas: [...FASTAPI_ERROR_MODELS],
  });
  return { tags, schemas, metrics: collectApiMetrics(), webSockets: (spec as { "x-websocket-routes": string[] })["x-websocket-routes"] };
}

export function collectWidgetsSchema(): SchemaSet {
  const set = describeSet(referencePath("backend", "widgets_schema.json"), "widgets.json", readReference("backend", "widgets_schema.json"), "definitions", { inline: true });
  return renameType(set, "plugin_type", "<type>");
}

interface ArgsCase {
  label: string;
  schema: unknown;
}

export function collectWidgetArgs(): SchemaSet {
  const source = readReference("frontend", "widget-args-reference.json") as { paramName: string; data: ArgsCase[]; ui: ArgsCase[] };
  const set: SchemaSet = {
    source: referencePath("frontend", "widget-args-reference.json"),
    title: "get_widget_schema",
    definitions: [describeCases("data_args_schema", source.data), describeCases("ui_args_schema", source.ui)],
  };
  const named = renameType(set, source.paramName, "<paramName>");
  return renameType(named, "config.setting", "config.<setting>");
}

export function collectAppsSchema(): SchemaSet {
  return describeSet(referencePath("frontend", "apps-schema.json"), "apps.json", readReference("frontend", "apps-schema.json"), "definitions");
}

export function collectManifestSchema(): SchemaSet {
  return describeSet(
    referencePath("backend", "plugin_manifest_schema.json"),
    "plugin.json",
    readReference("backend", "plugin_manifest_schema.json"),
    "$defs",
  );
}

export function collectSettings(): SettingsData {
  const source = readReference("backend", "settings.json");
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
  const source = readReference("backend", "database_schema.json");
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
  const source = readReference("backend", "admin_cli.json");
  return {
    prog: source.prog as string,
    description: (source.description as string | null) ?? null,
    commands: (source.commands as Json[]).map(mapCommand),
  };
}

export function collectMcp(): McpData {
  const surface = readJson(SURFACE).surface as Json;
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
