import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MAX_FRAME_DEPTH,
  REQUEST_TIMEOUT_MS,
} from "~/components/Widgets/Helpers/useIframeProtocol";
import {
  IFRAME_MESSAGES,
  parseIframeParamsMessage,
  stringifyParamValue,
  type WorkspaceWidgetParamValue,
} from "~/types/iframeProtocol";
import { undescribed } from "./undescribed";

const OUT = process.env.REFERENCE_OUT ?? "";

const valueCases: { label: string; value: WorkspaceWidgetParamValue | undefined }[] = [
  { label: "a string", value: "a" },
  { label: "a number", value: 1.5 },
  { label: "a boolean", value: true },
  { label: "null", value: null },
  { label: "no value", value: undefined },
  { label: "a list", value: ["a", 2, false] },
  { label: "a list with a null", value: ["a", null, "b"] },
];

describe("the iframe protocol reference", () => {
  const messages = IFRAME_MESSAGES.map(({ direction, schema, meaning }) => ({
    direction,
    meaning,
    schema: z.toJSONSchema(schema, { target: "draft-7" }),
  }));

  it("describes every field of every message", () => {
    const missing = messages
      .flatMap(({ schema }) => undescribed(schema, "message"))
      .filter((path) => path !== "message.type");
    expect(missing).toEqual([]);
  });

  it("writes the reference data", () => {
    const values = valueCases.map(({ label, value }) => ({
      label,
      text: stringifyParamValue(value),
    }));
    const both = parseIframeParamsMessage({
      type: "workspace:params:update",
      params: { a: "1" },
      paramName: "b",
      value: "2",
    });
    expect(both).toEqual({ a: "1", b: "2" });
    if (OUT === "") return;
    mkdirSync(resolve(OUT), { recursive: true });
    writeFileSync(
      resolve(OUT, "iframe-reference.json"),
      `${JSON.stringify(
        {
          messages,
          limits: {
            requestTimeoutMs: REQUEST_TIMEOUT_MS,
            maxFrameDepth: MAX_FRAME_DEPTH,
          },
          values,
        },
        null,
        2,
      )}\n`,
    );
  });
});
