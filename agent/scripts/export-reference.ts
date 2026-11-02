import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { OPENAPI_OUTPUT, OUTPUT, renderOpenApi, renderReference } from "./reference/index.ts";

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, await renderReference());
writeFileSync(OPENAPI_OUTPUT, renderOpenApi());
process.stdout.write(`wrote ${OUTPUT}\nwrote ${OPENAPI_OUTPUT}\n`);
process.exit(0);
