import { Hono } from "hono";
import { z } from "zod";
import { defineRoute, named } from "../lib/openapi.ts";
import type { Store } from "../lib/store.ts";

export const statusRoute = defineRoute({
  method: "GET",
  path: "/status",
  tag: "service",
  summary: "Answers with the state of the agent.",
  description:
    'Answers {"status": "ok", "timestamp": ..., "sharedState": ...}. The timestamp says when the answer was made. sharedState is true when the agent keeps its state in Redis, which a deployment with more than one replica needs.',
  responses: [
    {
      code: "200",
      description: "The state of the agent.",
      schema: named(
        "AgentStatus",
        z.object({
          status: z.string().describe("The state of the agent, which is ok when it serves requests."),
          timestamp: z.string().describe("When the answer was made, as a time in ISO 8601."),
          sharedState: z
            .boolean()
            .describe("Whether the agent keeps its state in Redis, which a deployment with more than one replica needs."),
        }),
        "output",
      ),
    },
  ],
  secured: false,
});

export function createStatusRouter(store: Store): Hono {
  const router = new Hono();
  router.get(statusRoute.path, (c) =>
    c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      sharedState: store.shared,
    }),
  );
  return router;
}
