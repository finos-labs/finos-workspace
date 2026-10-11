# syntax=docker/dockerfile:1

FROM oven/bun:1-slim AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# The companion MCP server: the tools the agent uses (web search, page fetch, document search, ...).
# Only the Workspace talks to it, so it is not meant to be reachable from outside the deployment.
FROM oven/bun:1-slim AS ines-mcp

ENV NODE_ENV=production
ENV MCP_PORT=8787

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY mcp-server ./mcp-server
# The few modules the tools share with the agent (logging, metrics, chat scopes, guarded fetching).
COPY src/lib/logging.ts src/lib/redact.ts src/lib/metrics.ts src/lib/scope.ts src/lib/safe-fetch.ts src/lib/isolate.ts src/lib/isolate-protocol.ts src/lib/isolate-child.ts src/lib/zip-guard.ts src/lib/bounded-cache.ts src/lib/html-page.ts src/lib/html-child.ts src/lib/page-text.ts src/lib/page-view.ts ./src/lib/

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const port = process.env.MCP_PORT || '8787'; const res = await fetch(`http://127.0.0.1:${port}/`); if (!res.ok) process.exit(1);"]

USER bun

CMD ["bun", "mcp-server/src/server.ts"]

FROM oven/bun:1-slim AS ines

ENV NODE_ENV=production
ENV PORT=7777

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src

# Build identity. CI passes the commit sha; local builds fall back to "dev".
# Baked in as OTEL_SERVICE_VERSION, which becomes `service.version` on every
# exported span (src/lib/telemetry.ts) — the attribute that makes a latency or
# cost regression attributable to a specific deploy.
#
# Declared AFTER the COPY layers on purpose: this value changes every commit,
# and an ENV higher up would invalidate the cached dependency layers below it.
ARG GIT_SHA=dev
ENV OTEL_SERVICE_VERSION=$GIT_SHA

EXPOSE 7777

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const port = process.env.PORT || '7777'; const res = await fetch(`http://127.0.0.1:${port}/status`); if (!res.ok) process.exit(1);"]

USER bun

CMD ["bun", "src/server.ts"]
