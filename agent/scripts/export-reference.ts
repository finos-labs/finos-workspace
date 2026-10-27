import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { OUTPUT, renderReference } from "./reference/index.ts";

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, await renderReference());
process.stdout.write(`wrote ${OUTPUT}\n`);
process.exit(0);
