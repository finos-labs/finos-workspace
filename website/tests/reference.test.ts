import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldTree, type FlatField, splitNotes, splitPath } from "../src/components/Reference/fieldtree.ts";
import { parseInline, parseProse } from "../src/components/Reference/markup.ts";

function field(path: string): FlatField {
  return { path, type: ["string"], required: false, constraints: [] };
}

test("splits a description into paragraphs, lists and code", () => {
  const blocks = parseProse(
    ["Conventions:", "- Use `snake_case`.", "- Reuse ids", "  from results.", "", "1. First", "2. Second", "", "```", "{ }", "```", "Last line."].join("\n"),
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["paragraph", "list", "list", "code", "paragraph"],
  );
  assert.equal(blocks[1]?.kind === "list" && blocks[1].ordered, false);
  assert.equal(blocks[2]?.kind === "list" && blocks[2].ordered, true);
  assert.deepEqual(blocks[1]?.kind === "list" && blocks[1].items[1], [{ kind: "text", text: "Reuse ids from results." }]);
});

test("joins wrapped lines of a paragraph and drops blank input", () => {
  assert.deepEqual(parseProse("one\ntwo"), [{ kind: "paragraph", inline: [{ kind: "text", text: "one two" }] }]);
  assert.deepEqual(parseProse("  \n\n"), []);
});

test("reads code, bold and links inside a line", () => {
  assert.deepEqual(parseInline("Call `a` and **b** at [site](https://example.test/x)."), [
    { kind: "text", text: "Call " },
    { kind: "code", text: "a" },
    { kind: "text", text: " and " },
    { kind: "bold", text: "b" },
    { kind: "text", text: " at " },
    { kind: "link", text: "site", href: "https://example.test/x" },
    { kind: "text", text: "." },
  ]);
});

test("does not turn a bold word at the start of a line into a list", () => {
  assert.equal(parseProse("**Note** this")[0]?.kind, "paragraph");
});

test("finds the parent of a nested path", () => {
  assert.deepEqual(splitPath("tabs[].name"), { parent: "tabs", name: "name" });
  assert.deepEqual(splitPath("a.b.c"), { parent: "a.b", name: "c" });
  assert.equal(splitPath("plain"), null);
});

test("nests fields under their parents and keeps orphans at the top", () => {
  const tree = fieldTree([field("tabs"), field("tabs[].name"), field("tabs[].meta"), field("tabs[].meta.id"), field("lost.child")]);
  assert.deepEqual(
    tree.map((node) => node.name),
    ["tabs", "lost.child"],
  );
  const tabs = tree[0];
  assert.deepEqual(
    tabs?.children.map((node) => node.name),
    ["name", "meta"],
  );
  assert.deepEqual(
    tabs?.children[1]?.children.map((node) => node.name),
    ["id"],
  );
});

test("separates the default from the other notes", () => {
  assert.deepEqual(splitNotes(["default null", "minLength 1"]), { defaultValue: "null", constraints: ["minLength 1"] });
  assert.deepEqual(splitNotes(["deprecated"]), { constraints: ["deprecated"] });
});
