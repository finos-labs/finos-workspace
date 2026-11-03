import { z } from "zod";
import {
  BUILT_IN_TYPES,
  DataContract,
  FORBIDDEN_HEADER_NAMES,
  FORBIDDEN_HEADER_PREFIXES,
  HEADER_NAME_PATTERN,
  HEADER_VALUE_PATTERN,
  LIMITS,
  McpToolContract,
  PARAM_LOCATIONS,
  ParamDefContract,
  PLUGIN_TYPE_RULES,
  RESERVED_HEADER_NAMES,
  WidgetBaseContract,
} from "./widgetsContract.ts";

const KIT_VERSION = 2;

type JsonSchema = Record<string, unknown>;

function markDiscriminators(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(markDiscriminators);
  if (!node || typeof node !== "object") return node;
  const marked = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, markDiscriminators(value)]),
  ) as JsonSchema;
  const branches = marked.oneOf;
  const discriminated =
    Array.isArray(branches) &&
    branches.length > 1 &&
    branches.every((branch) => {
      const b = branch as {
        properties?: { type?: { const?: unknown } };
        required?: string[];
      };
      return (
        typeof b.properties?.type?.const === "string" && b.required?.includes("type")
      );
    });
  return discriminated
    ? { discriminator: { propertyName: "type" }, ...marked }
    : marked;
}

function toJson(schema: z.ZodType): JsonSchema {
  const { $schema: _draft, ...rest } = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    reused: "inline",
  }) as JsonSchema;
  return markDiscriminators(rest) as JsonSchema;
}

const PARAM_DEF = { $ref: "#/definitions/ParamDef" };

export function buildWidgetsSchemaKit() {
  const base = toJson(WidgetBaseContract) as {
    properties: Record<string, JsonSchema>;
    required: string[];
  };
  const { description: paramsDescription } = base.properties.params;
  base.properties.params = {
    description: paramsDescription,
    type: "array",
    maxItems: LIMITS.params,
    items: {
      if: { type: "array" },
      // biome-ignore lint/suspicious/noThenProperty: a JSON Schema keyword, not a thenable
      then: { type: "array", maxItems: LIMITS.rowParams, items: PARAM_DEF },
      else: PARAM_DEF,
    },
  };
  base.properties.mcp_tool = {
    $ref: "#/definitions/McpTool",
    description: base.properties.mcp_tool.description,
  };

  const json = (properties: Record<string, z.ZodType>) =>
    Object.fromEntries(
      Object.entries(properties).map(([key, schema]) => [key, toJson(schema)]),
    );
  const types = Object.fromEntries(
    Object.entries(BUILT_IN_TYPES).map(([type, contract]) => [
      type,
      {
        summary: contract.summary,
        returns: contract.returns,
        properties: json(contract.properties),
        dataProperties: json(contract.dataProperties),
        methods: [...contract.methods],
        locations: [...contract.locations],
        reservedQueryNames: [...contract.reservedQueryNames],
      },
    ]),
  );

  return {
    kitVersion: KIT_VERSION,
    definitions: {
      ParamDef: toJson(ParamDefContract),
      McpTool: toJson(McpToolContract),
    },
    base: { properties: base.properties, required: base.required },
    data: toJson(DataContract),
    types,
    pluginTypes: {
      properties: json(PLUGIN_TYPE_RULES.properties),
      dataProperties: json(PLUGIN_TYPE_RULES.dataProperties),
      methods: [...PLUGIN_TYPE_RULES.methods],
      locations: [...PLUGIN_TYPE_RULES.locations],
      reservedQueryNames: [...PLUGIN_TYPE_RULES.reservedQueryNames],
    },
    paramLocations: [...PARAM_LOCATIONS],
    headers: {
      namePattern: HEADER_NAME_PATTERN,
      valuePattern: HEADER_VALUE_PATTERN,
      forbidden: [...FORBIDDEN_HEADER_NAMES],
      forbiddenPrefixes: [...FORBIDDEN_HEADER_PREFIXES],
      reserved: [...RESERVED_HEADER_NAMES],
    },
  };
}

type WidgetsSchemaKit = ReturnType<typeof buildWidgetsSchemaKit>;

export const KIT_PATH =
  "../backend-api/backend/api/widget_plugins/widgets_schema_kit.json";

export function serializeKit(kit: WidgetsSchemaKit): string {
  return `${JSON.stringify(kit, null, 2)}\n`;
}
