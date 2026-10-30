import type { SchemaDoc, SchemaProperty, SchemaSet, SchemaVariant, TypeLabel } from "../../src/data/types.ts";

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
  if (isObject(schema.then) && isObject(schema.else)) return joinLabels([typeLabel(schema.else), typeLabel(schema.then)], " | ");
  if (Array.isArray(schema.enum)) {
    const shown = schema.enum.slice(0, MAX_ENUM).map(literal).join(" | ");
    return [schema.enum.length > MAX_ENUM ? `${shown} | … (${schema.enum.length} values)` : shown];
  }
  const alternatives = list(schema.anyOf).length > 0 ? list(schema.anyOf) : list(schema.oneOf);
  if (alternatives.length > 0) {
    const labels = alternatives.map(typeLabel);
    const distinct = labels.filter((label, index) => labels.findIndex((other) => JSON.stringify(other) === JSON.stringify(label)) === index);
    return joinLabels(distinct, " | ");
  }
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

function enumValues(schema: Json): string[] | undefined {
  if (Array.isArray(schema.enum)) return schema.enum.map(literal);
  for (const branch of [...list(schema.anyOf), ...list(schema.oneOf)]) {
    if (Array.isArray(branch.enum)) return branch.enum.map(literal);
  }
  return undefined;
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

function referencedDescription(property: Json, definitions: Json): string | undefined {
  const refs = [property.$ref, ...list(property.allOf).map((item) => item.$ref)].filter(
    (ref): ref is string => typeof ref === "string",
  );
  for (const ref of refs) {
    const target = definitions[refName(ref)];
    if (isObject(target) && typeof target.description === "string") return target.description;
  }
  return undefined;
}

interface Options {
  inline: boolean;
}

function follow(schema: Json, definitions: Json, hops = 0): Json {
  if (typeof schema.$ref !== "string" || hops > 8) return schema;
  const found = definitions[refName(schema.$ref)];
  if (!isObject(found)) return schema;
  const { $ref: _ref, ...own } = schema;
  return { ...follow(found, definitions, hops + 1), ...own };
}

function hasProperties(schema: Json): boolean {
  return Object.keys(propertiesOf(schema)).length > 0;
}

function branchesOf(schema: Json, definitions: Json): Json[] | undefined {
  const direct = list(schema.oneOf).length > 0 ? list(schema.oneOf) : list(schema.anyOf);
  const nested = list(schema.allOf).flatMap((item) => list(item.oneOf));
  const found = (direct.length > 0 ? direct : nested).map((branch) => follow(branch, definitions));
  return found.length > 1 && found.every(hasProperties) ? found : undefined;
}

function elementOf(schema: Json, definitions: Json): Json | undefined {
  if (!isObject(schema.items)) return undefined;
  return follow(schema.items, definitions);
}

function rows(schema: Json, prefix: string, depth: number, definitions: Json, options: Options): SchemaProperty[] {
  const result: SchemaProperty[] = [];
  const required = requiredOf(schema);
  for (const [name, value] of Object.entries(propertiesOf(schema))) {
    const property = isObject(value) ? value : {};
    const target = options.inline ? follow(property, definitions) : property;
    const expanded = options.inline && typeof property.$ref === "string" && hasProperties(target) && branchesOf(target, definitions) === undefined;
    const row: SchemaProperty = {
      name: `${prefix}${name}`,
      type: expanded ? ["object"] : typeLabel(property),
      required: required.has(name),
      notes: constraintNotes(target),
    };
    const description = typeof target.description === "string" ? target.description : referencedDescription(property, definitions);
    if (description !== undefined) row.description = description;
    const values = enumValues(target);
    if (values !== undefined) row.enum = values;
    result.push(row);
    if (depth < MAX_DEPTH) {
      if (target.type === "object" && hasProperties(target) && (expanded || typeof property.$ref !== "string")) {
        result.push(...rows(target, `${prefix}${name}.`, depth + 1, definitions, options));
      }
      const element = elementOf(target, definitions);
      if (element !== undefined && element.type === "object" && hasProperties(element) && branchesOf(element, definitions) === undefined) {
        result.push(...rows(element, `${prefix}${name}[].`, depth + 1, definitions, options));
      }
    }
  }
  return result;
}

function discriminatorOf(branches: Json[]): string | undefined {
  const first = branches[0];
  if (first === undefined) return undefined;
  return Object.keys(propertiesOf(first)).find((key) =>
    branches.every((branch) => {
      const property = propertiesOf(branch)[key];
      return isObject(property) && "const" in property;
    }),
  );
}

function appliesTo(labels: string[], all: string[], shared: boolean): string | undefined {
  if (labels.length === all.length) return undefined;
  if (shared || labels.length * 2 <= all.length) return `for ${labels.join(", ")}`;
  return `not for ${all.filter((label) => !labels.includes(label)).join(", ")}`;
}

function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && text.startsWith(" | ", index)) {
      parts.push(current);
      current = "";
      index += 2;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function unionType(types: TypeLabel[]): TypeLabel {
  if (types.every((type) => type.every((part) => typeof part === "string"))) {
    const parts = types.flatMap((type) => topLevelParts(type.join("")));
    return [[...new Set(parts)].join(" | ")];
  }
  const distinct = types.filter((type, index) => types.findIndex((other) => JSON.stringify(other) === JSON.stringify(type)) === index);
  return joinLabels(distinct, " | ");
}

function mergedRow(name: string, groups: { row: SchemaProperty; labels: string[] }[], labels: string[]): SchemaProperty {
  const [first] = groups;
  const common = (first?.row.notes ?? []).filter((note) => groups.every((group) => group.row.notes.includes(note)));
  const covered = groups.flatMap((group) => group.labels);
  const values = [...new Set(groups.flatMap((group) => group.row.enum ?? []))];
  const row: SchemaProperty = {
    name,
    type: unionType(groups.map((group) => group.row.type)),
    required: covered.length === labels.length && groups.every((group) => group.row.required),
    notes: common,
    variants: groups.map(
      (group): SchemaVariant => ({
        applies: group.labels.join(", "),
        type: group.row.type,
        required: group.row.required,
        notes: group.row.notes.filter((note) => !common.includes(note)),
        ...(group.row.enum === undefined ? {} : { enum: group.row.enum }),
      }),
    ),
  };
  const note = appliesTo([...new Set(covered)], labels, false);
  if (note !== undefined) row.notes.push(note);
  if (first?.row.description !== undefined) row.description = first.row.description;
  if (values.length > 0) row.enum = values;
  return row;
}

function unionRows(branches: Json[], definitions: Json, options: Options): { properties: SchemaProperty[]; notes: string[] } {
  const key = discriminatorOf(branches);
  const labels = branches.map((branch, index) => {
    const property = key === undefined ? undefined : propertiesOf(branch)[key];
    return isObject(property) ? String(property.const) : `variant ${index + 1}`;
  });
  const byName = new Map<string, { row: SchemaProperty; labels: string[] }[]>();
  branches.forEach((branch, index) => {
    for (const row of rows(branch, "", 0, definitions, options)) {
      const groups = byName.get(row.name) ?? [];
      if (!byName.has(row.name)) byName.set(row.name, groups);
      const same = groups.find(
        (group) => JSON.stringify([group.row.type, group.row.required, group.row.description, group.row.notes, group.row.enum]) === JSON.stringify([row.type, row.required, row.description, row.notes, row.enum]),
      );
      if (same !== undefined) same.labels.push(labels[index] as string);
      else groups.push({ row, labels: [labels[index] as string] });
    }
  });
  const properties: SchemaProperty[] = [];
  for (const [name, groups] of byName) {
    if (name === key) {
      const merged = branches.map((branch) => literal((propertiesOf(branch)[name] as Json).const));
      const descriptions = new Set(groups.map((group) => group.row.description));
      const row: SchemaProperty = { name, type: [merged.join(" | ")], required: groups.every((group) => group.row.required), notes: [], enum: merged };
      const [only] = [...descriptions];
      if (descriptions.size === 1 && only !== undefined) row.description = only;
      properties.push(row);
      continue;
    }
    const [first] = groups;
    if (first === undefined) continue;
    if (groups.length === 1) {
      const note = appliesTo(first.labels, labels, false);
      properties.push(note === undefined ? first.row : { ...first.row, notes: [...first.row.notes, note] });
      continue;
    }
    properties.push(mergedRow(name, groups, labels));
  }
  const notes = [...new Set(branches.flatMap(ruleNotes))];
  return { properties, notes };
}

export function describeSchema(name: string, schema: unknown, definitions: Json = {}, options: Options = { inline: false }): SchemaDoc {
  const json = isObject(schema) ? schema : {};
  const branches = options.inline ? branchesOf(json, definitions) : undefined;
  const doc: SchemaDoc = branches
    ? { name, type: ["object"], ...unionRows(branches, definitions, options) }
    : { name, type: typeLabel(json), properties: rows(json, "", 0, definitions, options), notes: [...constraintNotes(json), ...ruleNotes(json)] };
  if (typeof json.description === "string") doc.description = json.description;
  const extended = list(json.allOf).filter((item) => typeof item.$ref === "string");
  for (const item of extended) doc.notes.unshift(`extends ${refName(item.$ref as string)}`);
  return doc;
}

export function describeSet(source: string, title: string, schema: unknown, definitionsKey: string, options: Options = { inline: false }): SchemaSet {
  const json = isObject(schema) ? schema : {};
  const definitions = isObject(json[definitionsKey]) ? (json[definitionsKey] as Json) : {};
  const keep = (doc: SchemaDoc, original: unknown): SchemaDoc => (options.inline ? { ...doc, json: original } : doc);
  const set: SchemaSet = {
    source,
    title,
    definitions: Object.keys(definitions)
      .sort()
      .map((name) => keep(describeSchema(name, definitions[name], definitions, options), definitions[name])),
  };
  if (typeof json.description === "string") set.description = json.description;
  const { [definitionsKey]: _omitted, ...rest } = json;
  if (rest.properties !== undefined || rest.type !== undefined || rest.items !== undefined || rest.$ref !== undefined) {
    set.root = keep(describeSchema(title, rest, definitions, options), rest);
  }
  return set;
}
