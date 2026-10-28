// Builds the plugin package for a Workspace plugins directory:
//
//   dist/<plugin id>/<version>/plugin.json, entry.js, entry.css, assets/icon.svg
//
// entry.js is src/entry.tsx bundled with esbuild, React and AG Grid Community included,
// because a plugin frame receives one module and its styles, nothing else. entry.css is the
// view's styles; AG Grid's theme adds its own CSS at runtime, which the frame's policy
// allows. plugin.json gets the version from package.json and the checksum Workspace
// verifies: the SHA-256, unpadded base64url, of the sorted lines "<path>\0<sha256 hex>\n" of
// every file except plugin.json. The version digest printed at the end covers plugin.json
// too; a deployer pins it.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));

const out = join(root, "dist", manifest.id, pkg.version);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });

await build({
  entryPoints: { entry: join(root, "src/entry.tsx") },
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
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
