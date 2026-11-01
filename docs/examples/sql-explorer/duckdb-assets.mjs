import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const DUCKDB_VERSION = "v1.5.4";
const EXTENSIONS = {
  autocomplete: "56ed85e85c671a262eb010b276278244c8a26e9146005f780ec5e34fb3cb2dec",
  json: "993b19f7929cc305b2529c548f2842e8e7a5b112d1c88f31c84798b51901ca16",
};
const SHIPPED_ELSEWHERE = {
  "@duckdb/duckdb-wasm": [join(here, "third-party/duckdb-wasm.LICENSE"), join(here, "third-party/duckdb.LICENSE")],
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function duckdbFiles(duckdbDist) {
  const extensionFiles = {};
  for (const [name, digest] of Object.entries(EXTENSIONS)) {
    const file = `${name}.duckdb_extension.wasm`;
    const cached = join(here, ".cache", DUCKDB_VERSION, file);
    if (!existsSync(cached) || sha256(readFileSync(cached)) !== digest) {
      const url = `https://extensions.duckdb.org/${DUCKDB_VERSION}/wasm_eh/${file}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== digest) throw new Error(`${url} does not match its pinned SHA-256`);
      mkdirSync(dirname(cached), { recursive: true });
      writeFileSync(cached, bytes);
    }
    extensionFiles[`assets/${file}`] = cached;
  }
  return {
    "assets/duckdb-eh.wasm": join(duckdbDist, "duckdb-eh.wasm"),
    "assets/duckdb-browser-eh.worker.js": join(duckdbDist, "duckdb-browser-eh.worker.js"),
    ...extensionFiles,
  };
}

export function copyLicenses(out, metafile, duckdbDist) {
  const packages = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const parts = resolve(input).split(sep);
    const at = parts.lastIndexOf("node_modules");
    if (at < 0) continue;
    const name = parts[at + 1].startsWith("@") ? `${parts[at + 1]}/${parts[at + 2]}` : parts[at + 1];
    packages.add([...parts.slice(0, at + 1), ...name.split("/")].join(sep));
  }
  packages.add(dirname(duckdbDist));
  for (const directory of [...packages].sort()) {
    const about = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const target = join(out, "licenses", about.name.replace(/^@/, "").replaceAll("/", "-"));
    const notices = [
      ...readdirSync(directory)
        .filter((f) => /^(licen[cs]e|notice|copying)/i.test(f))
        .map((f) => join(directory, f)),
      ...(SHIPPED_ELSEWHERE[about.name] ?? []),
    ];
    if (!notices.length) throw new Error(`${about.name} ${about.version} has no licence file to ship`);
    mkdirSync(target, { recursive: true });
    for (const file of notices) copyFileSync(file, join(target, file.split(sep).pop()));
    console.log(`bundled ${about.name} ${about.version} (${about.license})`);
  }
}
