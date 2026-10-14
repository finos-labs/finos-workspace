import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

/**
 * Validation of a backend's `widgets.json` against the schema in force for the user's
 * entity (docs/widget-plugins/WIDGETS-JSON.md 3.6), which the API composes from the
 * built-in types and the enabled plugins' types. Two steps, for readable errors: the
 * `type` against the schema's `x-types`, then the widget against that type's branch,
 * each problem with its JSON pointer.
 */

export interface ComposedWidgetsSchema {
  $id: string;
  "x-types": string[];
  definitions: Record<string, SchemaNode>;
  [key: string]: unknown;
}

type SchemaNode = Record<string, unknown>;

export interface SchemaProblem {
  /** JSON pointer into the widget definition; "" is the widget itself */
  pointer: string;
  message: string;
}

const compiled = new Map<
  string,
  { ajv: Ajv; branches: Map<string, ValidateFunction> }
>();
const MAX_COMPILED = 8;

/** The compiled validator of one definition of the schema, such as `Widget_markdown`. */
function validatorFor(
  schema: ComposedWidgetsSchema,
  definition: string,
): ValidateFunction {
  let entry = compiled.get(schema.$id);
  if (!entry) {
    if (compiled.size >= MAX_COMPILED) compiled.clear();
    // Rule nodes constrain values the shapes already type, so they carry no type of their
    // own; `discriminator` picks a param's branch by its type
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

/** The node a `#/...` path names in the composed schema. */
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

/**
 * Ajv reports paths from the definition it compiled, so for `Widget_<type>` `#/allOf/0` is
 * `#/definitions/Widget_<type>/allOf/0`; paths into referenced definitions are absolute.
 */
function absolutePath(definition: string, schemaPath: string): string {
  return schemaPath.startsWith("#/definitions/")
    ? schemaPath
    : `#/definitions/${definition}${schemaPath.slice(1)}`;
}

/** The rule an error belongs to: the nearest `allOf` member on its path with a description. */
function ruleOf(schema: ComposedWidgetsSchema, path: string): string | undefined {
  const segments = path.replace(/^#\//, "").split("/");
  for (let end = segments.length; end >= 2; end--) {
    if (segments[end - 2] !== "allOf") continue;
    const node = schemaAt(schema, `#/${segments.slice(0, end).join("/")}`);
    if (typeof node?.description === "string") return node.description;
  }
  return undefined;
}

/** "a string", "a number", ... for the members of a value union. */
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
      // A pattern the contract describes says what it means
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

/** The problems of one widget definition under its type's branch. */
export function validateWidgetDefinition(
  schema: ComposedWidgetsSchema,
  widget: Record<string, unknown>,
): SchemaProblem[] {
  const type = widget.type;
  if (typeof type !== "string") return [{ pointer: "", message: "missing `type`" }];
  if (!schema["x-types"].includes(type))
    return [
      {
        pointer: "/type",
        message: `\`${type}\` is not a widget type here, which has \`${schema["x-types"].join("`, `")}\``,
      },
    ];

  const definition = `Widget_${type}`;
  const validate = validatorFor(schema, definition);
  if (validate(widget)) return [];

  const errors = validate.errors ?? [];
  // The members of a failed value union say less than the union does
  const unions = errors
    .filter((e) => e.keyword === "anyOf")
    .map((e) => absolutePath(definition, e.schemaPath).replace(/\/anyOf$/, ""));
  const problems = new Map<string, SchemaProblem>();
  for (const error of errors) {
    // `if` reports that its `then` or `else` failed; their own errors say what is wrong
    if (error.keyword === "if") continue;
    const path = absolutePath(definition, error.schemaPath);
    if (unions.some((u) => path.startsWith(`${u}/anyOf/`))) continue;
    const rule = ruleOf(schema, path);
    // A rule is about the widget, or for the header rule the param, not one value of it
    const pointer = rule
      ? path.startsWith("#/definitions/ParamDef/")
        ? error.instancePath.replace(/\/(paramName|value|in)$/, "")
        : ""
      : error.instancePath;
    const message = rule ?? describe(error, schema, path);
    problems.set(`${pointer}\u0000${message}`, { pointer, message });
  }
  return [...problems.values()];
}

/**
 * The problems of the `plugin.config` a template sets for a widget of a plugin type: the
 * plugin's settings, closed (WIDGETS-JSON 3.10). A type no plugin renders here takes none.
 */
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
