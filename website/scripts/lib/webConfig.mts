import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import type { WebBuildVariable, WebConfigData, WebConfigField, WebConfigGroup } from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";

const SCHEMA_FILE = "frontend/src/lib/runtimeConfigSchema.ts";
const APP_CONFIG_FILE = "frontend/app-config.js";

const ZOD_STUB = `
const node = (kind, extra = {}) => {
  const self = {
    kind,
    ...extra,
    default(value) {
      self.hasDefault = true;
      self.defaultValue = value;
      return self;
    },
    describe(text) {
      self.description = text;
      return self;
    },
    meta(values) {
      self.metadata = values;
      return self;
    },
  };
  return self;
};
const z = {
  string: () => node("string"),
  boolean: () => node("boolean"),
  array: (item) => node("array", { item }),
  enum: (values) => node("enum", { values }),
  preprocess: (_coerce, schema) => schema,
  object: (shape) => ({ kind: "object", shape }),
};
`;

interface StubNode {
  kind: string;
  hasDefault?: boolean;
  defaultValue?: unknown;
  description?: string;
  metadata?: { itemValues?: string[] };
  values?: string[];
  shape?: Record<string, StubNode>;
}

interface SchemaModule {
  RuntimeConfigSchema: { shape: Record<string, StubNode> };
  ENV_NAMES: Record<string, Record<string, string>>;
  BUILD_VARIABLES: Record<string, Omit<WebBuildVariable, "name">>;
}

const TYPE_NAMES: Record<string, string> = {
  string: "string",
  bool: "boolean",
  list: "list",
  theme: "enum",
};

async function loadSchema(): Promise<SchemaModule> {
  const source = readFileSync(fromRepo(SCHEMA_FILE), "utf8").replace(/^import \{ z \} from "zod";\s*$/m, "");
  const code = `${ZOD_STUB}\n${stripTypeScriptTypes(source)}`;
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)) as SchemaModule;
}

export async function collectWebConfig(): Promise<WebConfigData> {
  const schema = await loadSchema();
  const appConfig = (await import(pathToFileURL(fromRepo(APP_CONFIG_FILE)).href)) as {
    default: { FIELDS: [string, string, string, string][] };
  };

  const groups = new Map<string, WebConfigGroup>();
  for (const [group, field, containerVariable, type] of appConfig.default.FIELDS) {
    const node = (schema.RuntimeConfigSchema.shape[group]?.shape as Record<string, StubNode>)[field] as StubNode;
    const entry: WebConfigField = {
      field,
      path: `${group}.${field}`,
      containerVariable,
      buildVariable: schema.ENV_NAMES[group]?.[field] as string,
      type: TYPE_NAMES[type] ?? type,
      default: node.hasDefault ? node.defaultValue : null,
      description: node.description ?? "",
    };
    if (entry.description === "") throw new Error(`${entry.path} has no description in ${SCHEMA_FILE}`);
    if (node.kind === "enum") entry.values = node.values;
    if (node.metadata?.itemValues) entry.itemValues = node.metadata.itemValues;
    if (!groups.has(group)) groups.set(group, { name: group, fields: [] });
    (groups.get(group) as WebConfigGroup).fields.push(entry);
  }
  const buildVariables = Object.entries(schema.BUILD_VARIABLES).map(([name, variable]) => {
    if (variable.description.trim() === "") throw new Error(`${name} has no description in ${SCHEMA_FILE}`);
    return { name, ...variable };
  });
  return { groups: [...groups.values()], buildVariables };
}
