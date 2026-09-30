// Checks render-frontend-config.sh against RuntimeConfigSchema, so the two cannot
// drift apart. The image build runs it from terminalpro/:
//   bun scripts/check-runtime-config.ts
// It fails when a schema field is missing from the script's FIELDS table (or the
// table names a field the schema does not have), when the config.js the script
// writes is rejected by the schema, or when the script accepts an invalid value.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { RuntimeConfigSchema } from "../src/lib/runtimeConfigSchema";

type Config = Record<string, Record<string, unknown>>;

const script = resolve(process.cwd(), "render-frontend-config.sh");
const out = join(mkdtempSync(join(tmpdir(), "app-config-")), "config.js");

const table = readFileSync(script, "utf8").match(/^FIELDS='\n([^']*)'$/m);
if (!table) throw new Error(`No FIELDS table in ${script}`);
const rows = table[1]
  .trim()
  .split("\n")
  .map((line) => {
    const [group, field, variable, type] = line.trim().split(/\s+/);
    return { path: `${group}.${field}`, group, field, variable, type };
  });

// For each type: a value to set in the environment, and the value config.js
// must then hold.
const samples: Record<string, [string, unknown]> = {
  string: ['a "quoted" \\ value', 'a "quoted" \\ value'],
  bool: ["false", false],
  list: [" One,two ,,", ["one", "two"]],
  theme: ["light", "light"],
};

function render(env: Record<string, string>): Config {
  execFileSync("sh", [script], {
    env: { PATH: process.env.PATH, APP_CONFIG_PATH: out, ...env },
    stdio: "pipe",
  });
  const sandbox: { window: { __APP_CONFIG__?: unknown } } = { window: {} };
  runInNewContext(readFileSync(out, "utf8"), sandbox);
  return JSON.parse(JSON.stringify(sandbox.window.__APP_CONFIG__));
}

const errors: string[] = [];

const schemaPaths = Object.entries(RuntimeConfigSchema.shape).flatMap(
  ([group, groupSchema]) =>
    Object.keys((groupSchema as unknown as { shape: object }).shape).map(
      (field) => `${group}.${field}`,
    ),
);
const tablePaths = rows.map((row) => row.path);
for (const path of schemaPaths) {
  if (!tablePaths.includes(path)) errors.push(`${path} is missing from FIELDS`);
}
for (const path of new Set(tablePaths)) {
  if (!schemaPaths.includes(path)) errors.push(`${path} is not in the schema`);
  if (tablePaths.indexOf(path) !== tablePaths.lastIndexOf(path)) {
    errors.push(`${path} is in FIELDS more than once`);
  }
}
for (const row of rows) {
  if (!(row.type in samples)) errors.push(`${row.path} has unknown type ${row.type}`);
}

if (!RuntimeConfigSchema.safeParse(render({})).success) {
  errors.push("config.js written with no variables set fails the schema");
}

const written = render(
  Object.fromEntries(rows.map((row) => [row.variable, samples[row.type]?.[0] ?? ""])),
);
const parsed = RuntimeConfigSchema.safeParse(written);
if (!parsed.success) {
  errors.push(
    `config.js written with every variable set fails the schema: ${parsed.error.message}`,
  );
} else {
  const data = parsed.data as Config;
  for (const row of rows) {
    const expected = JSON.stringify(samples[row.type]?.[1]);
    if (JSON.stringify(written[row.group]?.[row.field]) !== expected) {
      errors.push(`${row.path}: ${row.variable} is not written as ${expected}`);
    } else if (JSON.stringify(data[row.group]?.[row.field]) !== expected) {
      errors.push(`${row.path}: the schema changes the written value`);
    }
  }
}

try {
  render({ AUTHENTICATION_ALLOW_REGISTRATION: "yes" });
  errors.push("the script accepted an invalid boolean");
} catch {
  // Expected: invalid values stop the script, so the container does not start.
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `render-frontend-config.sh covers all ${schemaPaths.length} RuntimeConfigSchema fields`,
);
