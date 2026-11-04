import { Redis } from "ioredis";
import { getLogger } from "./logger.ts";

const logger = getLogger(["mcp", "redis"]);

let client: Redis | null | undefined = undefined;

export function getRedisClient(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    client = null;
    return null;
  }
  try {
    const c = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });
    c.on("error", (err) => {
      logger.warn(`Redis error: ${err instanceof Error ? err.message : String(err)}`);
    });
    c.on("connect", () => logger.info("Redis connected"));
    client = c;
    return c;
  } catch (err) {
    logger.warn(`Failed to create Redis client: ${err instanceof Error ? err.message : String(err)}`);
    client = null;
    return null;
  }
}

export function _setRedisClientForTest(c: Redis | null | undefined): void {
  client = c;
}
