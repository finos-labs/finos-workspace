// Builds the plugin package for a Workspace plugins directory:
//
//   dist/<plugin id>/<version>/plugin.json, entry.js, entry.css, assets/icon.svg
//
// entry.js is src/widget.js with plotly.js inlined, because a plugin frame receives one
// module and its styles, nothing else. The bundle is plotly.js's strict one: every trace
// type, built without function constructors, which the frame's policy refuses.
// plugin.json gets the version from package.json and the checksum Workspace verifies: the
// SHA-256, unpadded base64url, of the sorted lines "<path>\0<sha256 hex>\n" of every file
// except plugin.json. The version digest printed at the end covers plugin.json too; a
// deployer pins it.
//
// Node's standard library only. The bundle is read from node_modules, or from
// PLOTLY_BUNDLE when set.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));

const bundle =
  process.env.PLOTLY_BUNDLE ??
  createRequire(import.meta.url).resolve("plotly.js-strict-dist-min/plotly-strict.min.js");
const plotly = readFileSync(bundle, "utf8");

const placeholder = '"__PLOTLY_SOURCE__"';
const widget = readFileSync(join(root, "src/widget.js"), "utf8");
if (widget.split(placeholder).length !== 2) throw new Error("src/widget.js needs one plotly placeholder");

const out = join(root, "dist", manifest.id, pkg.version);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
// A function, so "$&" and the like in the bundle are not read as replacement patterns
writeFileSync(join(out, "entry.js"), widget.replace(placeholder, () => JSON.stringify(plotly)));
copyFileSync(join(root, "src/entry.css"), join(out, "entry.css"));
copyFileSync(join(root, "src/assets/icon.svg"), join(out, "assets/icon.svg"));

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function listingDigest(paths) {
  const lines = paths
    .map((path) => relative(out, path).split("\\").join("/"))
    .sort()
    .map((name) => `${name}\0${createHash("sha256").update(readFileSync(join(out, name))).digest("hex")}\n`)
    .join("");
  return `sha256-${createHash("sha256").update(lines).digest("base64url")}`;
}

const checksum = listingDigest(files(out));
writeFileSync(join(out, "plugin.json"), `${JSON.stringify({ ...manifest, version: pkg.version, checksum }, null, 2)}\n`);

console.log(`built ${relative(root, out)}`);
console.log(`checksum ${checksum}`);
console.log(`version digest ${listingDigest(files(out))}`);
