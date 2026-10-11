import { Hono } from "hono";
import type { Store } from "../lib/store";

/**
 * `/status` says the process is up, and whether what it keeps between the requests of a turn is
 * shared with the other replicas.
 *
 * The store is given here rather than read from the request, because this route is public: the
 * middleware that puts the services on the context runs for `/v1/*` only, so a route that asked the
 * context would always answer that nothing is shared.
 */
export function createStatusRouter(store: Store): Hono {
  const router = new Hono();
  router.get("/status", (c) =>
    c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      // False with more than one replica running means a user has a share of their quota per replica
      // and a continuation that lands elsewhere is counted as a new turn: set REDIS_URL.
      sharedState: store.shared,
    }),
  );
  return router;
}
