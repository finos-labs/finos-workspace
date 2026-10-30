import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));

const require = createRequire(import.meta.url);
const agGridMain = require.resolve("ag-grid-community");
const agGridDistPkg = dirname(agGridMain);           // .../ag-grid-community/dist/package
const agGridDir = dirname(dirname(agGridDistPkg));   // .../ag-grid-community (package root)
const agGridStylesDir = join(agGridDir, "styles");

const out = join(root, "dist", manifest.id, pkg.version);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });

/* ---- Bundle entry.js with esbuild (ag-grid-community bundled in) ---- */
const bundled = await build({
  entryPoints: [join(root, "src/entry.js")],
  outfile: join(out, "entry.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  logLevel: "warning",
});

/* ---- Inline AgGrid theme CSS into entry.css ---- */
const themeCssFiles = ["ag-grid.css", "ag-theme-quartz.css", "ag-theme-quartz-dark.css"];
let agGridCss = "";
for (const name of themeCssFiles) {
  const path = join(agGridStylesDir, name);
  try {
    agGridCss += `\n/* ${name} */\n${readFileSync(path, "utf8")}\n`;
  } catch {
    /* file may not exist in all versions, skip */
  }
}
const entryCss = readFileSync(join(root, "src/entry.css"), "utf8");
const combinedCss = entryCss + agGridCss;
writeFileSync(join(out, "entry.css"), combinedCss);

/* ---- Copy assets ---- */
copyFileSync(join(root, "src/assets/icon.svg"), join(out, "assets/icon.svg"));

/* ---- Third-party licenses ---- */
const agGridPkg = JSON.parse(readFileSync(join(agGridDir, "package.json"), "utf8"));
const agGridLicensePath = join(agGridDir, "LICENSE.txt");
const agGridLicense = readFileSync(agGridLicensePath, "utf8").trim();
const enterpriseNotices = ["ag-grid-charts-enterprise", "ag-charts-enterprise", "ag-charts-community"].map((name) => {
  const dir = join(root, "node_modules", name);
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const licenseFile = ["LICENSE.txt", "LICENSE", "LICENSE.md"].map((f) => join(dir, f)).find((f) => { try { return statSync(f).isFile(); } catch { return false; } });
  const text = licenseFile ? readFileSync(licenseFile, "utf8").trim() : `See ${meta.homepage ?? "https://www.ag-grid.com/"}`;
  return `${name} ${meta.version} (${meta.license}): ${meta.description ?? ""}\n\n${text}\n`;
});
writeFileSync(
  join(out, "assets/THIRD-PARTY-LICENSES.txt"),
  [`ag-grid-community ${agGridPkg.version} (${agGridPkg.license}): The ag-grid Community data grid\n\n${agGridLicense}\n`, ...enterpriseNotices].join("\n---\n\n")
);

/* ---- Checksum & manifest ---- */
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

const allFiles = files(out);
const checksum = listingDigest(allFiles);
writeFileSync(
  join(out, "plugin.json"),
  `${JSON.stringify({ ...manifest, version: pkg.version, checksum }, null, 2)}\n`
);

console.log(`built ${relative(root, out)}`);
console.log(`checksum ${checksum}`);
console.log(`version digest ${listingDigest(allFiles)}`);