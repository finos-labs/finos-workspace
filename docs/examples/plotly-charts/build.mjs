import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));

const require = createRequire(import.meta.url);
const bundle = process.env.PLOTLY_BUNDLE ?? require.resolve("plotly.js-strict-dist-min/plotly-strict.min.js");
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));
const WORKER_EXPORT = /export\{[\w$]+ as default\};/g;
const exports = readFileSync(bundle, "utf8").match(WORKER_EXPORT) ?? [];
if (exports.length !== 1) throw new Error(`expected MapLibre's worker export once in plotly.js, found ${exports.length}`);
const DYNAMIC_CODE = [
  ['new Function("return this")()', "void 0"],
  ["globalThis.eval(r)", 'throw Error("a worker source must be a module")'],
];
let plotly = readFileSync(bundle, "utf8").replace(WORKER_EXPORT, "");
for (const [code, replacement] of DYNAMIC_CODE) {
  const found = plotly.split(code).length - 1;
  if (found !== 1) throw new Error(`expected ${JSON.stringify(code)} once in plotly.js, found ${found}`);
  plotly = plotly.replace(code, () => replacement);
}
if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(plotly)) throw new Error("plotly.js still has dynamic code after the build");

const placeholder = '"__PLOTLY_SOURCE__"';
const entry = readFileSync(join(root, "src/entry.js"), "utf8");
if (entry.split(placeholder).length !== 2) throw new Error("src/entry.js needs one plotly placeholder");

const out = join(root, "dist", manifest.id, pkg.version);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
writeFileSync(join(out, "entry.js"), entry.replace(placeholder, () => JSON.stringify(plotly)));
copyFileSync(join(root, "src/entry.css"), join(out, "entry.css"));
copyFileSync(join(root, "src/assets/icon.svg"), join(out, "assets/icon.svg"));
cpSync(join(root, "src/skills"), join(out, "skills"), { recursive: true });
const outlines = join(packageDir("sane-topojson"), "dist");
for (const name of readdirSync(outlines).filter((n) => n.endsWith(".json")))
  copyFileSync(join(outlines, name), join(out, "assets", `topojson-${name}`));
copyFileSync(join(packageDir("mathjax"), "tex-svg.js"), join(out, "assets/mathjax-tex-svg.js"));

const notices = [
  ["plotly.js-strict-dist-min", "plotly.js"],
  ["mathjax", "MathJax, with its font @mathjax/mathjax-newcm-font"],
  ["sane-topojson", "the map outlines, from Natural Earth"],
].map(([name, what]) => {
  const meta = JSON.parse(readFileSync(join(packageDir(name), "package.json"), "utf8"));
  const license = readFileSync(join(packageDir(name), "LICENSE"), "utf8").trim();
  return `${name} ${meta.version} (${meta.license}): ${what}\n\n${license}\n`;
});
writeFileSync(join(out, "assets/THIRD-PARTY-LICENSES.txt"), notices.join(`\n${"-".repeat(78)}\n\n`));

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
