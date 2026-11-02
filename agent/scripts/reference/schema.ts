import { z } from "zod";
import { jsonSchemaFields, type SchemaField } from "./json-schema.ts";

export function schemaFields(schema: z.ZodType): SchemaField[] {
  return jsonSchemaFields(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }));
}

export type { SchemaField };
