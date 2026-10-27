export interface SchemaField {
  path: string;
  type: string;
  required: boolean;
  limits: string | null;
  description: string;
}

type Json = Record<string, unknown>;

const NUMBER = new Intl.NumberFormat("en-US");

function count(value: unknown): string {
  return NUMBER.format(value as number);
}

function limitsOf(node: Json): string | null {
  const parts: string[] = [];
  if (typeof node.minLength === "number" && typeof node.maxLength === "number") {
    parts.push(`${count(node.minLength)} to ${count(node.maxLength)} characters`);
  } else if (typeof node.maxLength === "number") {
    parts.push(`at most ${count(node.maxLength)} characters`);
  } else if (typeof node.minLength === "number" && node.minLength > 0) {
    parts.push(`at least ${count(node.minLength)} characters`);
  }
  if (typeof node.minItems === "number" && typeof node.maxItems === "number") {
    parts.push(`${count(node.minItems)} to ${count(node.maxItems)} items`);
  } else if (typeof node.maxItems === "number") {
    parts.push(`at most ${count(node.maxItems)} items`);
  } else if (typeof node.minItems === "number" && node.minItems > 0) {
    parts.push(`at least ${count(node.minItems)} items`);
  }
  if (typeof node.pattern === "string") parts.push(`matches ${node.pattern}`);
  if (typeof node.minimum === "number" && node.minimum > -Number.MAX_SAFE_INTEGER) parts.push(`at least ${count(node.minimum)}`);
  if (typeof node.maximum === "number" && node.maximum < Number.MAX_SAFE_INTEGER) parts.push(`at most ${count(node.maximum)}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function typeOf(node: Json): string {
  if (Array.isArray(node.anyOf)) {
    const labels = (node.anyOf as Json[]).map(typeOf);
    return [...new Set(labels)].join(" or ");
  }
  if (Array.isArray(node.enum)) return (node.enum as unknown[]).map((value) => JSON.stringify(value)).join(" | ");
  if (node.const !== undefined) return JSON.stringify(node.const);
  const type = node.type;
  if (type === "array") return `array of ${node.items ? typeOf(node.items as Json) : "any"}`;
  if (type === "object") return "object";
  if (typeof type === "string") return type;
  if (Array.isArray(type)) return type.join(" or ");
  return "any";
}

function nested(node: Json): Json | null {
  if (Array.isArray(node.anyOf)) {
    const found = (node.anyOf as Json[]).map(nested).find((item) => item !== null);
    return found ?? null;
  }
  if (node.type === "object" && node.properties) return node;
  if (node.type === "array" && node.items) return nested(node.items as Json);
  return null;
}

function arrayOfObjects(node: Json): boolean {
  if (Array.isArray(node.anyOf)) return (node.anyOf as Json[]).some(arrayOfObjects);
  return node.type === "array" && nested(node) !== null;
}

function limitsOfAny(node: Json): string | null {
  if (Array.isArray(node.anyOf)) {
    for (const branch of node.anyOf as Json[]) {
      const found = limitsOf(branch);
      if (found) return found;
    }
    return null;
  }
  return limitsOf(node);
}

function descriptionOf(node: Json): string {
  if (typeof node.description === "string") return node.description;
  if (Array.isArray(node.anyOf)) {
    for (const branch of node.anyOf as Json[]) {
      if (typeof branch.description === "string") return branch.description;
    }
  }
  return "";
}

function walk(node: Json, prefix: string, depth: number, out: SchemaField[]): void {
  const required = new Set((node.required as string[] | undefined) ?? []);
  for (const [name, raw] of Object.entries((node.properties as Record<string, Json>) ?? {})) {
    const path = prefix ? `${prefix}.${name}` : name;
    out.push({
      path,
      type: typeOf(raw),
      required: required.has(name),
      limits: limitsOfAny(raw),
      description: descriptionOf(raw),
    });
    const inner = nested(raw);
    if (inner && depth < 2) walk(inner, arrayOfObjects(raw) ? `${path}[]` : path, depth + 1, out);
  }
}

export function jsonSchemaFields(json: object): SchemaField[] {
  const out: SchemaField[] = [];
  walk(json as Json, "", 0, out);
  return out;
}
