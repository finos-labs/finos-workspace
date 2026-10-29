import { Hono } from "hono";
import type { Store } from "../lib/store.ts";

export function createStatusRouter(store: Store): Hono {
  const router = new Hono();
  router.get("/status", (c) =>
    c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      sharedState: store.shared,
    }),
  );
  return router;
}
