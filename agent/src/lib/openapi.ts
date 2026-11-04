import { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A schema with the name that the reference gives it. */
export interface NamedSchema {
  name: string;
  zod?: z.ZodType;
  json?: Record<string, unknown>;
  io: "input" | "output";
}

export function named(name: string, schema: z.ZodType, io: "input" | "output" = "input"): NamedSchema {
  return { name, zod: schema, io };
}

/** A schema that the code writes by hand, such as the fields of a multipart form. */
export function json(name: string, value: Record<string, unknown>): NamedSchema {
  return { name, json: value, io: "input" };
}

export interface RouteParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  description: string;
  schema?: Record<string, unknown>;
}

export interface RouteResponse {
  code: string;
  description: string;
  contentType?: string;
  schema?: NamedSchema;
}

/** What a helper route does with the request and what it answers. */
export interface RouteHelper {
  detail: string;
  answer: string;
  fallback: string;
}

/**
 * The definition of a route that the agent serves. It sits next to the handler that answers the
 * route, so that the method, the path, the request and the answers are written once.
 */
export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  description: string;
  parameters?: RouteParameter[];
  request?: { contentType: string; required: boolean; schema: NamedSchema };
  responses: RouteResponse[];
  /** The route needs an agent token, unless the agent runs with AGENT_AUTH=none. */
  secured: boolean;
  helper?: RouteHelper;
}

export function defineRoute(definition: RouteDefinition): RouteDefinition {
  return definition;
}

/** The body that the agent answers an error with. */
export const ErrorBody = z.object({
  error: z.string().describe("What went wrong."),
  details: z.array(z.unknown()).optional().describe("The fields that did not fit the schema, when the request was invalid."),
});

export const errorBody = named("Error", ErrorBody, "output");

export function invalidRequest(): RouteResponse {
  return { code: "400", description: "The body is not JSON, or it does not fit the schema of the route.", schema: errorBody };
}

export function unauthorized(): RouteResponse {
  return { code: "401", description: "The request carries no agent token, or the token is not valid.", schema: errorBody };
}

export function bodyTooLarge(): RouteResponse {
  return { code: "413", description: "The body is larger than the limit of the route.", schema: errorBody };
}

export function tooManyRequests(): RouteResponse {
  return { code: "429", description: "The user has made too many requests.", schema: errorBody };
}

export function busy(): RouteResponse {
  return { code: "503", description: "The agent is busy and cannot take the request now.", schema: errorBody };
}

const JSON_SCHEMA_TARGET = "draft-2020-12";

export function schemaJson(schema: NamedSchema): Record<string, unknown> {
  if (schema.json !== undefined) return schema.json;
  if (schema.zod === undefined) throw new Error(`The schema ${schema.name} has neither a Zod schema nor a JSON schema.`);
  const json = z.toJSONSchema(schema.zod, {
    target: JSON_SCHEMA_TARGET,
    io: schema.io,
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export interface OpenApiInfo {
  title: string;
  version: string;
  description: string;
}

export interface TagDescription {
  name: string;
  description: string;
}

/** Builds the OpenAPI document that describes the routes that the agent serves. */
export function buildOpenApiDocument(
  definitions: RouteDefinition[],
  info: OpenApiInfo,
  tags: TagDescription[] = [],
): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, Record<string, unknown>> = {};

  const reference = (schema: NamedSchema): Record<string, unknown> => {
    if (schemas[schema.name] === undefined) schemas[schema.name] = schemaJson(schema);
    return { $ref: `#/components/schemas/${schema.name}` };
  };

  for (const definition of definitions) {
    const operation: Record<string, unknown> = {
      tags: [definition.tag],
      summary: definition.summary,
      description: definition.description,
      responses: {},
    };

    if (definition.parameters && definition.parameters.length > 0) {
      operation.parameters = definition.parameters.map((parameter) => ({
        name: parameter.name,
        in: parameter.in,
        required: parameter.required,
        description: parameter.description,
        schema: parameter.schema ?? { type: "string" },
      }));
    }

    if (definition.request) {
      operation.requestBody = {
        required: definition.request.required,
        content: {
          [definition.request.contentType]: { schema: reference(definition.request.schema) },
        },
      };
    }

    const responses: Record<string, unknown> = {};
    for (const response of definition.responses) {
      const contentType = response.contentType ?? "application/json";
      responses[response.code] = {
        description: response.description,
        content: {
          [contentType]: { schema: response.schema ? reference(response.schema) : { type: "string" } },
        },
      };
    }
    operation.responses = responses;

    if (definition.secured) operation.security = [{ bearerAuth: [] }];

    const path = paths[definition.path] ?? {};
    path[definition.method.toLowerCase()] = operation;
    paths[definition.path] = path;
  }

  return {
    openapi: "3.1.0",
    info,
    tags: tags.length > 0 ? tags : [...new Set(definitions.map((definition) => definition.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "The agent token that the workspace gives the user. The request carries it in the header Authorization, after the word Bearer.",
        },
      },
      schemas,
    },
  };
}

export interface AppRoute {
  method: string;
  path: string;
}

/** Fails when the definitions and the routes that the app serves do not match. */
export function assertRoutesMatch(routes: AppRoute[], definitions: RouteDefinition[]): void {
  const served = new Set(
    routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} ${route.path}`),
  );
  const defined = new Set(definitions.map((definition) => `${definition.method} ${definition.path}`));
  for (const key of served) {
    if (!defined.has(key)) throw new Error(`The app serves ${key}, which has no route definition.`);
  }
  for (const key of defined) {
    if (!served.has(key)) throw new Error(`The route definition ${key} is not a route that the app serves.`);
  }
}
