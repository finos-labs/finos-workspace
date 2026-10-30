import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSchema } from "../scripts/lib/schema.mts";

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

test("merges the variants of a union and says which variant has each field", () => {
  const doc = describeSchema("Param", definitions.Param, definitions, { inline: true });
  const rows = doc.properties.map((row) => `${row.name}:${row.notes.join(",")}`);
  assert.deepEqual(rows, ["name:for text, number", "name:for form", "type:", "value:for text", "value:for number", "step:for number"]);
  const type = doc.properties.find((row) => row.name === "type");
  assert.deepEqual(type?.enum, ['"text"', '"number"', '"form"']);
  assert.deepEqual(
    doc.properties.filter((row) => row.name === "name").map((row) => row.required),
    [true, false],
  );
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
