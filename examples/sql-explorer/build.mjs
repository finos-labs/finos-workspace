// Builds the plugin package for a Workspace plugins directory:
//
//   dist/<plugin id>/<version>/plugin.json, entry.js, entry.css, assets/, backend/, licenses/
//
// entry.js is src/widget.js bundled by esbuild into the one module a plugin frame loads,
// with the completion engine's client: DuckDB-WASM's browser build and the Arrow code it
// uses. DuckDB itself runs in a worker: its script is assets/duckdb-browser-eh.worker.js
// and its WebAssembly binary (the exception-handling build) assets/duckdb-eh.wasm, which
// the frame asks the host for when the editor is first used. DuckDB-WASM would download
// the extensions it needs on first use: autocomplete (sql_auto_complete) and json. The
// package carries them instead (assets/<name>.duckdb_extension.wasm), fetched here from
// DuckDB's extension repository and checked against pinned SHA-256s.
// licenses/ holds the licence and notice files of every package bundled into entry.js or
// copied into assets/.
//
// backend/ is the server-side code a deployer builds into an image (backend/Dockerfile)
// and runs beside Workspace; Workspace serves it to no browser. It is listed file by file,
// so nothing a local run leaves behind (__pycache__, a venv) enters a version.
//
// plugin.json gets the version from package.json and the checksum Workspace verifies: the
// SHA-256, unpadded base64url, of the sorted lines "<path>\0<sha256 hex>\n" of every file
// except plugin.json. The version digest printed at the end covers plugin.json too; a
// deployer pins it, and the backend reports it from the files it runs.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const duckdbDist = join(root, "node_modules/@duckdb/duckdb-wasm/dist");

// The extensions of the DuckDB inside @duckdb/duckdb-wasm (v1.5.4), for the
// exception-handling WebAssembly build, by name. A new DuckDB-WASM needs new hashes.
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
  "entry.css": "src/entry.css",
  "assets/icon.svg": "src/assets/icon.svg",
  "assets/duckdb-eh.wasm": join(relative(root, duckdbDist), "duckdb-eh.wasm"),
  "assets/duckdb-browser-eh.worker.js": join(relative(root, duckdbDist), "duckdb-browser-eh.worker.js"),
  ...extensionFiles,
  "backend/Dockerfile": "backend/Dockerfile",
  "backend/requirements.txt": "backend/requirements.txt",
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

const bundled = await build({
  entryPoints: [join(root, "src/widget.js")],
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

// The licences of what went into entry.js and assets/, package by package. A package
// whose npm files carry no licence text has it in third-party/ (third-party/README.md)
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
// The worker and the binary in assets/ are DuckDB-WASM's too
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
