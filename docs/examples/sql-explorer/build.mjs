import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { copyLicenses, duckdbFiles } from "./duckdb-assets.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const duckdbDist = join(root, "node_modules/@duckdb/duckdb-wasm/dist");

const FILES = {
  "entry.css": "src/entry.css",
  "assets/icon.svg": "src/assets/icon.svg",
  "backend/server.py": "backend/server.py",
  "backend/engines.py": "backend/engines.py",
  "backend/identity.py": "backend/identity.py",
  "backend/values.py": "backend/values.py",
};

const out = join(root, "dist", manifest.id, pkg.version);
rmSync(out, { recursive: true, force: true });
for (const [target, source] of Object.entries({
  ...Object.fromEntries(Object.entries(FILES).map(([target, source]) => [target, join(root, source)])),
  ...(await duckdbFiles(duckdbDist)),
})) {
  mkdirSync(dirname(join(out, target)), { recursive: true });
  copyFileSync(source, join(out, target));
}
cpSync(join(root, "src/skills"), join(out, "skills"), { recursive: true });

const bundled = await build({
  entryPoints: [join(root, "src/entry.js")],
  outfile: join(out, "entry.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  metafile: true,
  logLevel: "warning",
});

copyLicenses(out, bundled.metafile, duckdbDist);

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function listingDigest(paths) {
  const lines = paths
    .map((path) => relative(out, path).split(sep).join("/"))
    .sort()
    .map((name) => `${name}\0${createHash("sha256").update(readFileSync(join(out, name))).digest("hex")}\n`)
    .join("");
  return `sha256-${createHash("sha256").update(lines).digest("base64url")}`;
}

if (!existsSync(join(out, "entry.js"))) throw new Error("esbuild wrote no entry.js");
const checksum = listingDigest(files(out));
writeFileSync(join(out, "plugin.json"), `${JSON.stringify({ ...manifest, version: pkg.version, checksum }, null, 2)}\n`);

console.log(`built ${relative(root, out)}: entry.js ${(statSync(join(out, "entry.js")).size / 1024).toFixed(0)} KiB`);
console.log(`checksum ${checksum}`);
console.log(`version digest ${listingDigest(files(out))}`);
