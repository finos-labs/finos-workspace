# syntax=docker/dockerfile:1

# The model the end-to-end stack runs instead of a provider (see server.ts). It has no dependencies
# beyond Bun itself, so there is nothing to install and the image is the base plus one file.
FROM oven/bun:1.4.2-slim

ENV NODE_ENV=production
ENV PORT=11434

WORKDIR /app

COPY server.ts ./

EXPOSE 11434

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD ["bun", "-e", "const res = await fetch(`http://127.0.0.1:${process.env.PORT || '11434'}/health`); if (!res.ok) process.exit(1);"]

USER bun

CMD ["bun", "server.ts"]
