import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

export interface ComposedWidgetsSchema {
  $id: string;
  "x-types": string[];
  definitions: Record<string, SchemaNode>;
  [key: string]: unknown;
}

type SchemaNode = Record<string, unknown>;

export interface SchemaProblem {
  pointer: string;
  message: string;
}

const compiled = new Map<
  string,
  { ajv: Ajv; branches: Map<string, ValidateFunction> }
>();
const MAX_COMPILED = 8;

function validatorFor(
  schema: ComposedWidgetsSchema,
  definition: string,
): ValidateFunction {
  let entry = compiled.get(schema.$id);
  if (!entry) {
    if (compiled.size >= MAX_COMPILED) compiled.clear();
    const ajv = new Ajv({ allErrors: true, strictTypes: false, discriminator: true });
    ajv.addKeyword("x-types");
    ajv.addSchema(schema);
    entry = { ajv, branches: new Map() };
    compiled.set(schema.$id, entry);
  }
  let branch = entry.branches.get(definition);
  if (!branch) {
    const found = entry.ajv.getSchema(`${schema.$id}#/definitions/${definition}`);
    if (!found)
      throw new Error(`The widgets.json schema has no definition ${definition}`);
    branch = found;
    entry.branches.set(definition, branch);
  }
  return branch;
}

function schemaAt(schema: ComposedWidgetsSchema, path: string): SchemaNode | undefined {
  let node: unknown = schema;
  for (const segment of path.replace(/^#\/?/, "").split("/").filter(Boolean)) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[
      decodeURIComponent(segment).replace(/~1/g, "/").replace(/~0/g, "~")
    ];
  }
  return node && typeof node === "object" ? (node as SchemaNode) : undefined;
}

function absolutePath(definition: string, schemaPath: string): string {
  return schemaPath.startsWith("#/definitions/")
    ? schemaPath
    : `#/definitions/${definition}${schemaPath.slice(1)}`;
}

function ruleOf(schema: ComposedWidgetsSchema, path: string): string | undefined {
  const segments = path.replace(/^#\//, "").split("/");
  for (let end = segments.length; end >= 2; end--) {
    if (segments[end - 2] !== "allOf") continue;
    const node = schemaAt(schema, `#/${segments.slice(0, end).join("/")}`);
    if (typeof node?.description === "string") return node.description;
  }
  return undefined;
}

function kinds(node: SchemaNode): string[] {
  if (Array.isArray(node.anyOf)) return (node.anyOf as SchemaNode[]).flatMap(kinds);
  if ("const" in node) return [`\`${String(node.const)}\``];
  if (Array.isArray(node.enum))
    return (node.enum as unknown[]).map((v) => `\`${String(v)}\``);
  switch (node.type) {
    case "string":
      return [node.pattern ? `a string matching \`${node.pattern}\`` : "a string"];
    case "array":
      return ["a list"];
    case "object":
      return ["an object"];
    case "integer":
      return ["a whole number"];
    case "number":
      return ["a number"];
    case "boolean":
      return ["true or false"];
    case "null":
      return ["null"];
    default:
      return ["a value"];
  }
}

function describe(
  error: ErrorObject,
  schema: ComposedWidgetsSchema,
  path: string,
): string {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "additionalProperties":
      return `unknown key \`${params.additionalProperty}\``;
    case "required":
      return `missing \`${params.missingProperty}\``;
    case "enum":
      return `must be one of \`${(params.allowedValues as unknown[]).join("`, `")}\``;
    case "const":
      return `must be \`${String(params.allowedValue)}\``;
    case "pattern": {
      const node = schemaAt(schema, path.replace(/\/pattern$/, ""));
      return typeof node?.description === "string"
        ? `must be ${node.description}`
        : (error.message ?? "has the wrong format");
    }
    case "anyOf":
      return `must be ${kinds(schemaAt(schema, path.replace(/\/anyOf$/, "")) ?? {}).join(" or ")}`;
    case "discriminator": {
      const branches = (schemaAt(schema, path.replace(/\/discriminator$/, ""))?.oneOf ??
        []) as SchemaNode[];
      const types = branches.map(
        (b) => (b.properties as Record<string, SchemaNode>).type.const as string,
      );
      return params.error === "tag"
        ? `missing \`${params.tag}\`, one of \`${types.join("`, `")}\``
        : `\`${params.tag}\` must be one of \`${types.join("`, `")}\``;
    }
    default:
      return error.message ?? error.keyword;
  }
}

export interface WidgetDefinitionCheck {
  problems: SchemaProblem[];
  unknownKeys: string[];
}

function pointerSegment(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function validateWidgetDefinition(
  schema: ComposedWidgetsSchema,
  widget: Record<string, unknown>,
): WidgetDefinitionCheck {
  const type = widget.type;
  if (typeof type !== "string")
    return { problems: [{ pointer: "", message: "missing `type`" }], unknownKeys: [] };
  if (!schema["x-types"].includes(type))
    return {
      problems: [
        {
          pointer: "/type",
          message: `\`${type}\` is not a widget type here, which has \`${schema["x-types"].join("`, `")}\``,
        },
      ],
      unknownKeys: [],
    };

  const definition = `Widget_${type}`;
  const validate = validatorFor(schema, definition);
  if (validate(widget)) return { problems: [], unknownKeys: [] };

  const errors = validate.errors ?? [];
  const branchesOf = (keyword: "anyOf" | "oneOf") =>
    errors
      .filter((e) => e.keyword === keyword)
      .map(
        (e) =>
          `${absolutePath(definition, e.schemaPath).replace(new RegExp(`/${keyword}$`), "")}/${keyword}/`,
      );
  const anyOfBranches = branchesOf("anyOf");
  const unionBranches = [...anyOfBranches, ...branchesOf("oneOf")];
  const problems = new Map<string, SchemaProblem>();
  const unknownKeys: string[] = [];
  for (const error of errors) {
    if (error.keyword === "if") continue;
    const path = absolutePath(definition, error.schemaPath);
    if (anyOfBranches.some((branch) => path.startsWith(branch))) continue;
    if (
      error.keyword === "additionalProperties" &&
      !unionBranches.some((branch) => path.startsWith(branch))
    ) {
      const key = String(
        (error.params as { additionalProperty: unknown }).additionalProperty,
      );
      unknownKeys.push(`${error.instancePath}/${pointerSegment(key)}`);
      continue;
    }
    const rule = ruleOf(schema, path);
    const pointer = rule
      ? path.startsWith("#/definitions/ParamDef/")
        ? error.instancePath.replace(/\/(paramName|value|in)$/, "")
        : ""
      : error.instancePath;
    const message = rule ?? describe(error, schema, path);
    problems.set(`${pointer}\u0000${message}`, { pointer, message });
  }
  return { problems: [...problems.values()], unknownKeys };
}

export function withoutKeyAt(target: Record<string, unknown>, pointer: string): void {
  const segments = pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  const key = segments.pop();
  if (key === undefined) return;
  let node: unknown = target;
  for (const segment of segments) {
    if (!node || typeof node !== "object") return;
    node = (node as Record<string, unknown>)[segment];
  }
  if (
    node &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    Object.hasOwn(node, key)
  )
    delete (node as Record<string, unknown>)[key];
}

export function pluginConfigProblems(
  schema: ComposedWidgetsSchema,
  type: string,
  config: unknown,
): SchemaProblem[] {
  const definition = `PluginConfig_${type}`;
  if (!schema.definitions[definition])
    return [
      {
        pointer: "",
        message: `no plugin renders \`${type}\` here, so it takes no plugin configuration`,
      },
    ];
  const validate = validatorFor(schema, definition);
  if (validate(config)) return [];
  const problems = new Map<string, SchemaProblem>();
  for (const error of validate.errors ?? []) {
    const message = describe(error, schema, absolutePath(definition, error.schemaPath));
    problems.set(`${error.instancePath}\u0000${message}`, {
      pointer: error.instancePath,
      message,
    });
  }
  return [...problems.values()];
}
