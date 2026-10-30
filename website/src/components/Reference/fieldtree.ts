import type { TypeLabel } from "../../data/types.ts";

export interface FieldVariant {
  applies: string;
  type: TypeLabel;
  required: boolean;
  constraints: string[];
  enumValues?: string[];
  description?: string;
}

export interface FlatField {
  path: string;
  type: TypeLabel;
  required: boolean;
  description?: string | null;
  defaultValue?: string;
  constraints: string[];
  enumValues?: string[];
  variants?: FieldVariant[];
}

export interface FieldNode {
  name: string;
  field: FlatField;
  children: FieldNode[];
}

const LAST_SEGMENT = /^(.*)(?:\[\]\.|\.)([^.[\]]+)$/;

export function splitPath(path: string): { parent: string; name: string } | null {
  const match = LAST_SEGMENT.exec(path);
  if (match === null) return null;
  return { parent: (match[1] as string).replace(/\[\]$/, ""), name: match[2] as string };
}

export function fieldTree(fields: FlatField[]): FieldNode[] {
  const roots: FieldNode[] = [];
  const byPath = new Map<string, FieldNode>();
  for (const field of fields) {
    const split = splitPath(field.path);
    const parent = split === null ? undefined : byPath.get(split.parent);
    const node: FieldNode = { name: split !== null && parent !== undefined ? split.name : field.path, field, children: [] };
    byPath.set(field.path, node);
    if (parent !== undefined) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function splitNotes(notes: string[]): { defaultValue?: string; constraints: string[] } {
  const found = notes.find((note) => note.startsWith("default "));
  const constraints = notes.filter((note) => note !== found);
  return found === undefined ? { constraints } : { defaultValue: found.slice("default ".length), constraints };
}

export function labelText(label: TypeLabel): string {
  return label.map((part) => (typeof part === "string" ? part : part.ref)).join("");
}
