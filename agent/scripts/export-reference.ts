import { readFileSync, writeFileSync } from "node:fs";
import { FIXTURE, renderReference } from "./reference/index.ts";

const check = process.argv.includes("--check");
const rendered = await renderReference();
if (check) {
  if (readFileSync(FIXTURE, "utf8") !== rendered) {
    process.stderr.write(`stale: ${FIXTURE}\n`);
    process.exit(1);
  }
} else {
  writeFileSync(FIXTURE, rendered);
  process.stdout.write(`wrote ${FIXTURE}\n`);
}
process.exit(0);
