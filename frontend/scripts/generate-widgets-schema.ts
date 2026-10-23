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
