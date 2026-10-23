import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { serveOnce } from "../../../src/lib/isolate-child.ts";
await serveOnce((input: { pidFile: string }) => {
  writeFileSync(input.pidFile, String(process.pid));
  const db = new DatabaseSync(":memory:");
  // Inside one native call that never returns: nothing in JavaScript can stop it.
  return db.prepare("WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT count(*) FROM r").all();
});
