import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));

test("every skill the manifest lists is a markdown file under src/skills, with a slug and a description", () => {
  const skills = manifest.contributes.skills;
  assert.ok(skills.length > 0);
  for (const skill of skills) {
    assert.match(skill.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(skill.description.length > 0 && skill.description.length <= 300);
    assert.match(skill.file, /^skills\/[A-Za-z0-9._-]+\.md$/);
    const path = join(root, "src", skill.file);
    assert.ok(existsSync(path), `${skill.file} is missing`);
    const text = readFileSync(path, "utf8");
    assert.ok(text.trim().length > 0 && Buffer.byteLength(text) <= 32 * 1024);
  }
});

test("a widget with an artifact reads its data and describes it with a closed schema", () => {
  for (const widget of manifest.contributes.widgets.filter((widget) => widget.artifact)) {
    assert.ok(widget.permissions.includes("core:data:read"));
    assert.equal(widget.artifact.data.type, "object");
    assert.equal(widget.artifact.data.additionalProperties, false);
    assert.ok(widget.artifact.description.length <= 300);
  }
});
