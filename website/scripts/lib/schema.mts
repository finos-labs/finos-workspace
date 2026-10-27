import type { SchemaDoc, SchemaProperty, SchemaSet, TypeLabel } from "../../src/data/types.ts";

type Json = Record<string, unknown>;

const MAX_DEPTH = 3;
const MAX_ENUM = 12;
const MAX_PATTERN = 140;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

function joinLabels(labels: TypeLabel[], separator: string): TypeLabel {
  const joined: TypeLabel = [];
  labels.forEach((label, index) => {
    if (index > 0) joined.push(separator);
    joined.push(...label);
  });
  return joined;
}

function literal(value: unknown): string {
  return JSON.stringify(value);
}

export function typeLabel(schema: unknown): TypeLabel {
  if (!isObject(schema)) return ["any"];
  if (typeof schema.$ref === "string") return [{ ref: refName(schema.$ref) }];
  if ("const" in schema) return [literal(schema.const)];
  if (Array.isArray(schema.enum)) {
    const shown = schema.enum.slice(0, MAX_ENUM).map(literal).join(" | ");
    return [schema.enum.length > MAX_ENUM ? `${shown} | … (${schema.enum.length} values)` : shown];
  }
  const alternatives = list(schema.anyOf).length > 0 ? list(schema.anyOf) : list(schema.oneOf);
  if (alternatives.length > 0) return joinLabels(alternatives.map(typeLabel), " | ");
  const combined = list(schema.allOf).filter((item) => item.$ref !== undefined || item.type !== undefined);
  if (combined.length > 0) return joinLabels(combined.map(typeLabel), " & ");
  if (Array.isArray(schema.type)) return [schema.type.join(" | ")];
  if (schema.type === "array") {
    if (schema.items === undefined) return ["array"];
    const items = typeLabel(schema.items);
    const compound = items.some((part) => typeof part === "string" && part.includes(" | "));
    return compound ? ["(", ...items, ")[]"] : [...items, "[]"];
  }
  if (schema.type === "object") {
    if (isObject(schema.additionalProperties)) return ["map<string, ", ...typeLabel(schema.additionalProperties), ">"];
    return ["object"];
  }
  if (typeof schema.type === "string") {
    return [typeof schema.format === "string" ? `${schema.type} (${schema.format})` : schema.type];
  }
  return ["any"];
}

function truncate(text: string): string {
  return text.length > MAX_PATTERN ? `${text.slice(0, MAX_PATTERN)}…` : text;
}

function constraintNotes(schema: Json): string[] {
  const notes: string[] = [];
  if ("default" in schema) notes.push(`default ${literal(schema.default)}`);
  for (const key of [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
  ]) {
    if (key in schema) notes.push(`${key} ${literal(schema[key])}`);
  }
  if (typeof schema.pattern === "string") notes.push(`pattern ${truncate(schema.pattern)}`);
  if (schema.uniqueItems === true) notes.push("items are unique");
  if (schema.deprecated === true) notes.push("deprecated");
  if (schema.readOnly === true) notes.push("read only");
  if (schema.writeOnly === true) notes.push("write only");
  if (schema.additionalProperties === false) notes.push("no other properties");
  if (isObject(schema.propertyNames)) {
    const names = schema.propertyNames;
    const parts = ["maxLength", "pattern"].filter((key) => key in names).map((key) => `${key} ${truncate(String(names[key]))}`);
    if (parts.length > 0) notes.push(`property names: ${parts.join(", ")}`);
  }
  return notes;
}

function ruleNotes(schema: Json): string[] {
  return list(schema.allOf)
    .filter((item) => typeof item.description === "string")
    .map((item) => item.description as string);
}

function propertiesOf(schema: Json): Json {
  const merged: Json = isObject(schema.properties) ? { ...schema.properties } : {};
  for (const item of list(schema.allOf)) {
    if (isObject(item.properties)) Object.assign(merged, item.properties);
  }
  return merged;
}

function requiredOf(schema: Json): Set<string> {
  const required = new Set<string>(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  for (const item of list(schema.allOf)) {
    if (Array.isArray(item.required)) for (const name of item.required as string[]) required.add(name);
  }
  return required;
}

function rows(schema: Json, prefix: string, depth: number): SchemaProperty[] {
  const result: SchemaProperty[] = [];
  const required = requiredOf(schema);
  for (const [name, value] of Object.entries(propertiesOf(schema))) {
    const property = isObject(value) ? value : {};
    const row: SchemaProperty = {
      name: `${prefix}${name}`,
      type: typeLabel(property),
      required: required.has(name),
      notes: constraintNotes(property),
    };
    if (typeof property.description === "string") row.description = property.description;
    result.push(row);
    if (depth < MAX_DEPTH) {
      if (property.type === "object" && Object.keys(propertiesOf(property)).length > 0) {
        result.push(...rows(property, `${prefix}${name}.`, depth + 1));
      }
      if (isObject(property.items) && property.items.type === "object" && Object.keys(propertiesOf(property.items)).length > 0) {
        result.push(...rows(property.items, `${prefix}${name}[].`, depth + 1));
      }
    }
  }
  return result;
}

export function describeSchema(name: string, schema: unknown): SchemaDoc {
  const json = isObject(schema) ? schema : {};
  const doc: SchemaDoc = {
    name,
    type: typeLabel(json),
    properties: rows(json, "", 0),
    notes: [...constraintNotes(json), ...ruleNotes(json)],
  };
  if (typeof json.description === "string") doc.description = json.description;
  const extended = list(json.allOf).filter((item) => typeof item.$ref === "string");
  for (const item of extended) doc.notes.unshift(`extends ${refName(item.$ref as string)}`);
  return doc;
}

export function describeSet(source: string, title: string, schema: unknown, definitionsKey: string): SchemaSet {
  const json = isObject(schema) ? schema : {};
  const definitions = isObject(json[definitionsKey]) ? (json[definitionsKey] as Json) : {};
  const set: SchemaSet = {
    source,
    title,
    definitions: Object.keys(definitions)
      .sort()
      .map((name) => describeSchema(name, definitions[name])),
  };
  if (typeof json.description === "string") set.description = json.description;
  const { [definitionsKey]: _omitted, ...rest } = json;
  if (rest.properties !== undefined || rest.type !== undefined || rest.items !== undefined || rest.$ref !== undefined) {
    set.root = describeSchema(title, rest);
  }
  return set;
}
