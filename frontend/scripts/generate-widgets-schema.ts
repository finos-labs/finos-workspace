// Writes the widgets.json schema kit the API composes per entity (WIDGETS-JSON 3.5), from
// the Zod contract. Run from frontend/:
//   node scripts/generate-widgets-schema.ts
// A unit test fails when the committed kit differs from what this writes.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildWidgetsSchemaKit,
  KIT_PATH,
  serializeKit,
} from "../src/lib/types/widgetsSchemaKit.ts";

const out = resolve(process.cwd(), KIT_PATH);
writeFileSync(out, serializeKit(buildWidgetsSchemaKit()));
console.log(`Wrote ${out}`);
