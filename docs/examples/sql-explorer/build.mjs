import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const duckdbDist = join(root, "node_modules/@duckdb/duckdb-wasm/dist");

const DUCKDB_VERSION = "v1.5.4";
const EXTENSIONS = {
  autocomplete: "56ed85e85c671a262eb010b276278244c8a26e9146005f780ec5e34fb3cb2dec",
  json: "993b19f7929cc305b2529c548f2842e8e7a5b112d1c88f31c84798b51901ca16",
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const extensionFiles = {};
for (const [name, digest] of Object.entries(EXTENSIONS)) {
  const file = `${name}.duckdb_extension.wasm`;
  const cached = join(root, ".cache", DUCKDB_VERSION, file);
  if (!existsSync(cached) || sha256(readFileSync(cached)) !== digest) {
    const url = `https://extensions.duckdb.org/${DUCKDB_VERSION}/wasm_eh/${file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== digest) throw new Error(`${url} does not match its pinned SHA-256`);
    mkdirSync(dirname(cached), { recursive: true });
    writeFileSync(cached, bytes);
  }
  extensionFiles[`assets/${file}`] = relative(root, cached);
}

const FILES = {
  "assets/icon.svg": "src/assets/icon.svg",
  "assets/duckdb-eh.wasm": join(relative(root, duckdbDist), "duckdb-eh.wasm"),
  "assets/duckdb-browser-eh.worker.js": join(relative(root, duckdbDist), "duckdb-browser-eh.worker.js"),
  ...extensionFiles,
  "backend/server.py": "backend/server.py",
  "backend/engines.py": "backend/engines.py",
  "backend/identity.py": "backend/identity.py",
  "backend/values.py": "backend/values.py",
};

const out = join(root, "dist", manifest.id, pkg.version);
rmSync(out, { recursive: true, force: true });
for (const [target, source] of Object.entries(FILES)) {
  mkdirSync(dirname(join(out, target)), { recursive: true });
  copyFileSync(join(root, source), join(out, target));
}
cpSync(join(root, "src/skills"), join(out, "skills"), { recursive: true });

const agGridStyles = join(root, "node_modules/ag-grid-community/styles");
const stylesheet = ["ag-grid.css", "ag-theme-quartz.css"]
  .map((name) => readFileSync(join(agGridStyles, name), "utf8"))
  .concat(readFileSync(join(root, "src/entry.css"), "utf8"))
  .join("\n");
writeFileSync(join(out, "entry.css"), stylesheet);

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

const SHIPPED_ELSEWHERE = {
  "@duckdb/duckdb-wasm": ["third-party/duckdb-wasm.LICENSE", "third-party/duckdb.LICENSE"],
};
const packages = new Set();
for (const input of Object.keys(bundled.metafile.inputs)) {
  const parts = input.split(/[\\/]/);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0) continue;
  const name = parts[at + 1].startsWith("@") ? `${parts[at + 1]}/${parts[at + 2]}` : parts[at + 1];
  packages.add(join(...parts.slice(0, at + 1), ...name.split("/")));
}
packages.add(relative(root, dirname(duckdbDist)));
for (const directory of [...packages].sort()) {
  const about = JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8"));
  const target = join(out, "licenses", about.name.replace(/^@/, "").replaceAll("/", "-"));
  const notices = [
    ...readdirSync(join(root, directory))
      .filter((f) => /^(licen[cs]e|notice|copying)/i.test(f))
      .map((f) => join(root, directory, f)),
    ...(SHIPPED_ELSEWHERE[about.name] ?? []).map((f) => join(root, f)),
  ];
  if (!notices.length) throw new Error(`${about.name} ${about.version} has no licence file to ship`);
  mkdirSync(target, { recursive: true });
  for (const file of notices) copyFileSync(file, join(target, file.split(sep).pop()));
  console.log(`bundled ${about.name} ${about.version} (${about.license})`);
}

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
