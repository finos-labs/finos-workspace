import { readFileSync } from "node:fs";
import type { WebData } from "../../src/data/types.ts";
import { fromRepo } from "./paths.mts";

const NGINX = "frontend/nginx.conf";

export function collectWeb(): WebData {
  const ports = [...readFileSync(fromRepo(NGINX), "utf8").matchAll(/^\s*listen\s+(\d+)\s*;/gm)].map((match) => Number(match[1]));
  if (ports.length !== 1) throw new Error(`${NGINX} has ${ports.length} listen directives; the docs expect one`);
  return { port: ports[0] };
}
