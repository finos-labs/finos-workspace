// Checks app-config.js, which renders config.js in the nginx image, against
// RuntimeConfigSchema and nginx.conf, so they cannot drift apart. The image build
// runs it from frontend/:
//   bun scripts/check-runtime-config.ts
// It fails when a schema field is missing from the module's FIELDS table (or the
// table names a field the schema does not have), when nginx.conf does not pass
// exactly the table's variables to nginx's workers, when the config.js the module
// renders is rejected by the schema, or when the module accepts an invalid value.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { ENV_NAMES, RuntimeConfigSchema } from "../src/lib/runtimeConfigSchema";

type Config = Record<string, Record<string, unknown>>;
type AppConfig = {
  FIELDS: [string, string, string, string][];
  render(env: Record<string, string>): string;
};

// A plain JavaScript module for nginx's njs, so it is imported without types.
const appConfig: AppConfig = (await import(resolve(process.cwd(), "app-config.js"))).default;
const rows = appConfig.FIELDS.map(([group, field, variable, type]) => ({
  path: `${group}.${field}`,
  group,
  field,
  variable,
  type,
}));

// For each type: a value to set in the environment and the value config.js must then hold.
const samples: Record<string, [string, unknown]> = {
  string: ['a "quoted" \\ value', 'a "quoted" \\ value'],
  bool: ["false", false],
  list: [" One,two ,,", ["one", "two"]],
  theme: ["light", "light"],
};

function render(env: Record<string, string>): Config {
  const sandbox: { window: { __APP_CONFIG__?: unknown } } = { window: {} };
  runInNewContext(appConfig.render(env), sandbox);
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
// The container takes the variable names of ENV_NAMES without their VITE_ prefix.
for (const row of rows) {
  const name = (ENV_NAMES as Record<string, Record<string, string>>)[row.group]?.[row.field];
  if (name?.replace(/^VITE_/, "") !== row.variable) {
    errors.push(`${row.path}: ${row.variable} is not ${name} without VITE_`);
  }
}

// nginx passes its workers only the variables its env directives name.
const nginxConf = readFileSync(resolve(process.cwd(), "nginx.conf"), "utf8");
const passed = [...nginxConf.matchAll(/^env ([A-Z0-9_]+);$/gm)].map((match) => match[1]);
for (const row of rows) {
  if (!passed.includes(row.variable)) errors.push(`nginx.conf has no env ${row.variable};`);
}
for (const name of passed) {
  if (!rows.some((row) => row.variable === name)) {
    errors.push(`nginx.conf passes ${name}, which no field reads`);
  }
}

if (!RuntimeConfigSchema.safeParse(render({})).success) {
  errors.push("config.js rendered with no variables set fails the schema");
}

const written = render(
  Object.fromEntries(rows.map((row) => [row.variable, samples[row.type]?.[0] ?? ""])),
);
const parsed = RuntimeConfigSchema.safeParse(written);
if (!parsed.success) {
  errors.push(
    `config.js rendered with every variable set fails the schema: ${parsed.error.message}`,
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

// Invalid values make the module throw, so config.js and the health checks answer 500.
for (const [variable, value, what] of [
  ["AUTHENTICATION_ALLOW_EMAIL_LOGIN", "yes", "boolean"],
  ["UI_DEFAULT_THEME", "blue", "theme"],
]) {
  try {
    render({ [variable]: value });
    errors.push(`app-config.js accepted an invalid ${what}`);
  } catch {
    // Expected.
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`app-config.js covers all ${schemaPaths.length} RuntimeConfigSchema fields`);
