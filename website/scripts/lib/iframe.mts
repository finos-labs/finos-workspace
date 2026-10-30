import type { IframeData, SchemaDoc, SchemaSet } from "../../src/data/types.ts";
import { readReference, referencePath } from "./reference.mts";
import { describeSchema } from "./schema.mts";

type Json = Record<string, unknown>;

interface IframeReference {
  messages: { direction: "page" | "host"; meaning: string; schema: Json }[];
  limits: IframeData["limits"];
  values: IframeData["values"];
}

function nameOf(schema: Json): string {
  const type = (schema.properties as Record<string, Json>).type as Json;
  if (typeof type.const === "string") return type.const;
  return (type.enum as string[]).join(" or ");
}

export function collectIframe(): IframeData {
  const source = readReference("frontend", "iframe-reference.json") as unknown as IframeReference;
  const set = (direction: "page" | "host", title: string): SchemaSet => ({
    source: referencePath("frontend", "iframe-reference.json"),
    title,
    definitions: source.messages
      .filter((message) => message.direction === direction)
      .map((message): SchemaDoc => ({ ...describeSchema(nameOf(message.schema), message.schema), description: message.meaning })),
  });
  return {
    fromPage: set("page", "Messages from the page"),
    fromHost: set("host", "Messages from FINOS Workspace"),
    limits: source.limits,
    values: source.values,
  };
}
