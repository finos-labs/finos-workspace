# syntax=docker/dockerfile:1

FROM node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

ENV NODE_ENV=production
ENV PORT=11434

WORKDIR /app

COPY server.ts ./

EXPOSE 11434

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD ["node", "--input-type=module", "-e", "const res = await fetch(`http://127.0.0.1:${process.env.PORT || '11434'}/health`); if (!res.ok) process.exit(1);"]

USER node

CMD ["node", "server.ts"]
