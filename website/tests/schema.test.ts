import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCases, describeSchema } from "../scripts/lib/schema.mts";

const definitions = {
  Param: {
    oneOf: [
      { type: "object", required: ["name", "type"], properties: { name: { type: "string" }, type: { const: "text" }, value: { type: "string" } } },
      { type: "object", required: ["name", "type"], properties: { name: { type: "string" }, type: { const: "number" }, value: { type: "number" }, step: { type: "number" } } },
      { type: "object", required: ["type"], properties: { type: { const: "form" }, name: { type: "string" } } },
    ],
  },
  Box: { type: "object", properties: { size: { type: "integer", minimum: 1 } } },
};

test("merges the variants of a union into one row for each field", () => {
  const doc = describeSchema("Param", definitions.Param, definitions, { inline: true });
  assert.deepEqual(
    doc.properties.map((row) => row.name),
    ["name", "type", "value", "step"],
  );
  const type = doc.properties.find((row) => row.name === "type");
  assert.deepEqual(type?.enum, ['"text"', '"number"', '"form"']);
  const name = doc.properties.find((row) => row.name === "name");
  assert.equal(name?.required, false);
  assert.deepEqual(
    name?.variants?.map((variant) => [variant.applies, variant.required]),
    [
      ["text, number", true],
      ["form", false],
    ],
  );
  const value = doc.properties.find((row) => row.name === "value");
  assert.deepEqual(value?.type, ["string | number"]);
  assert.deepEqual(
    value?.variants?.map((variant) => variant.applies),
    ["text", "number"],
  );
  assert.deepEqual(doc.properties.find((row) => row.name === "step")?.notes, ["for number"]);
});

test("expands a referenced object inline and keeps it a link otherwise", () => {
  const schema = { type: "object", properties: { box: { $ref: "#/definitions/Box" } } };
  const inline = describeSchema("Holder", schema, definitions, { inline: true });
  assert.deepEqual(
    inline.properties.map((row) => row.name),
    ["box", "box.size"],
  );
  const linked = describeSchema("Holder", schema, definitions);
  assert.deepEqual(
    linked.properties.map((row) => row.name),
    ["box"],
  );
  assert.deepEqual(linked.properties[0]?.type, [{ ref: "Box" }]);
});

test("describes the schemas of several cases as one row with a list by case", () => {
  const object = (properties: Record<string, unknown>) => ({ type: "object", properties });
  const doc = describeCases("args", [
    { label: "text", schema: object({ value: { type: "string" } }) },
    { label: "number", schema: object({ value: { type: "number" } }) },
    { label: "form", schema: object({}) },
  ]);
  assert.deepEqual(
    doc.properties.map((row) => row.name),
    ["value"],
  );
  assert.deepEqual(
    doc.properties[0]?.variants?.map((variant) => variant.applies),
    ["text", "number"],
  );
  assert.ok(doc.notes.includes("no property for form"));
});
