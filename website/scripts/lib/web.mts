import { readFileSync } from "node:fs";
import type { PluginValueType, WebData } from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";
import { readReference } from "./reference.mts";

const NGINX = "frontend/nginx.conf";

export function collectWeb(): WebData {
  // The app's server block comes first; a later one serves the MCP App sandbox origin.
  const ports = [...readFileSync(fromRepo(NGINX), "utf8").matchAll(/^\s*listen\s+(\d+)\s*;/gm)].map((match) => Number(match[1]));
  if (ports.length === 0) throw new Error(`${NGINX} has no listen directive; the docs expect the app's port first`);
  const values = readReference("frontend", "web-app-reference.json").values as Record<string, PluginValueType>;
  return { port: ports[0], values };
}
