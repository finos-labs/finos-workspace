import assert from "node:assert/strict";
import { test } from "node:test";
import { lacksToc } from "../scripts/lib/toc.mts";

const heading = '<h3 class="anchor" id="schema-Backend">Backend</h3>';
const toc = '<div class="tableOfContents thin-scrollbar theme-doc-toc-desktop"></div>';

test("flags a page whose headings have no table of contents", () => {
  assert.equal(lacksToc(`<main><article><h1>Title</h1>${heading}</article></main>`), true);
});

test("accepts a page that has the table of contents", () => {
  assert.equal(lacksToc(`<main><article>${heading}</article>${toc}</main>`), false);
});

test("accepts a page that has no headings to list", () => {
  assert.equal(lacksToc("<main><article><h1>Title</h1><p>Text</p></article></main>"), false);
});

test("ignores headings outside the article", () => {
  assert.equal(lacksToc(`<nav>${heading}</nav><article><h1>Title</h1></article>`), false);
});
