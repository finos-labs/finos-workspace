# syntax=docker/dockerfile:1

FROM node:26.13.0-alpine3.24@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216

ENV NODE_ENV=production
ENV PORT=11434

WORKDIR /app

COPY server.ts ./

EXPOSE 11434

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD ["node", "--input-type=module", "-e", "const res = await fetch(`http://127.0.0.1:${process.env.PORT || '11434'}/health`); if (!res.ok) process.exit(1);"]

USER node

CMD ["node", "server.ts"]
