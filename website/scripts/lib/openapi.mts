import type { ApiData, ApiOperation, SchemaDoc } from "../../src/data/types.ts";
import { describeSchema, typeLabel } from "./schema.mts";

type Json = Record<string, any>;

const METHODS = ["get", "post", "put", "patch", "delete"];

export interface OpenApiOptions {
  /** The file that the document comes from, named when a description is missing. */
  source: string;
  /** The response codes to leave out, such as the validation error that FastAPI adds. */
  skipCodes?: string[];
  /** The schemas to leave out. */
  skipSchemas?: string[];
}

export interface OpenApiData {
  tags: ApiData["tags"];
  schemas: SchemaDoc[];
}

/**
 * Turns an OpenAPI document into the operations and the schemas that the reference pages render.
 * Every operation needs a description, every parameter needs a description and every field of a
 * schema needs a description, so that the document never leaves a route unexplained.
 */
export function collectOpenApi(spec: Json, options: OpenApiOptions): OpenApiData {
  const byTag = new Map<string, ApiOperation[]>();
  const undescribed: string[] = [];
  for (const path of Object.keys(spec.paths).sort()) {
    const item = spec.paths[path] as Json;
    for (const method of METHODS) {
      const operation = item[method] as Json | undefined;
      if (operation === undefined) continue;
      const tag = (operation.tags?.[0] as string | undefined) ?? "service";
      const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map((parameter: Json) => ({
        name: parameter.name as string,
        in: parameter.in as string,
        required: parameter.required === true,
        type: typeLabel(parameter.schema),
        description: parameter.description as string | undefined,
      }));
      const entry: ApiOperation = {
        method: method.toUpperCase(),
        path,
        tag,
        summary: (operation.summary as string | undefined) ?? "",
        description: ((operation.description as string | undefined) ?? "").trim(),
        parameters,
        responses: Object.entries((operation.responses ?? {}) as Json)
          .filter(([code]) => !(options.skipCodes ?? []).includes(code))
          .map(([code, response]: [string, Json]) => {
            const content = response.content ? (Object.values(response.content)[0] as Json) : undefined;
            const written = (response.description as string | undefined) ?? "";
            const standard = written === "Successful Response";
            return {
              code,
              description: standard ? (content ? "" : "No content") : written,
              schema: content ? typeLabel(content.schema) : undefined,
            };
          }),
        secured: operation.security !== undefined,
      };
      if (operation.requestBody) {
        const [contentType, content] = Object.entries(operation.requestBody.content as Json)[0] as [string, Json];
        entry.requestBody = {
          contentType,
          required: operation.requestBody.required === true,
          schema: typeLabel(content.schema),
        };
      }
      const label = `${entry.method} ${path}`;
      if (entry.description === "") undescribed.push(`${label} has no description`);
      for (const parameter of entry.parameters) {
        if (!parameter.description) undescribed.push(`${label} has no description for the parameter ${parameter.name}`);
      }
      if (!byTag.has(tag)) byTag.set(tag, []);
      (byTag.get(tag) as ApiOperation[]).push(entry);
    }
  }
  const schemas = (spec.components?.schemas ?? {}) as Json;
  const modelNames = Object.keys(schemas)
    .filter((name) => !(options.skipSchemas ?? []).includes(name))
    .sort();
  for (const name of modelNames) {
    for (const [property, value] of Object.entries((schemas[name].properties ?? {}) as Json)) {
      if (!value.description) undescribed.push(`${name}.${property} has no description`);
    }
  }
  if (undescribed.length > 0) throw new Error(`${options.source} lacks descriptions:\n${undescribed.join("\n")}`);
  return {
    tags: [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, operations]) => ({ name, operations })),
    schemas: modelNames.map((name) => describeSchema(name, schemas[name], schemas)),
  };
}
