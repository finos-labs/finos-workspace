import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CssData } from "../src/data/types.ts";
import {
  collectApi,
  collectAppsSchema,
  collectCli,
  collectDatabase,
  collectManifestSchema,
  collectMcp,
  collectSettings,
  collectWidgetsSchema,
} from "./lib/backend.mts";
import { collectCss } from "./lib/css.mts";
import { collectEnv } from "./lib/env.mts";
import { collectHooks } from "./lib/hooks.mts";
import { outDir } from "./lib/paths.mts";
import { collectPluginTokens, collectReport } from "./lib/theme.mts";
import { addUsage } from "./lib/usage.mts";
import { collectWebConfig } from "./lib/webConfig.mts";

const env = collectEnv();
const parsedCss = collectCss();
const css: CssData = {
  ...parsedCss,
  ...addUsage(parsedCss),
  report: collectReport(),
  pluginTokens: collectPluginTokens(parsedCss),
};

const outputs: Record<string, unknown> = {
  css,
  hooks: collectHooks(),
  webConfig: await collectWebConfig(),
  env,
  settings: collectSettings(env),
  api: collectApi(),
  widgetsSchema: collectWidgetsSchema(),
  appsSchema: collectAppsSchema(),
  manifestSchema: collectManifestSchema(),
  database: collectDatabase(),
  cli: collectCli(),
  mcp: collectMcp(),
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [name, data] of Object.entries(outputs)) {
  writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(data));
}
