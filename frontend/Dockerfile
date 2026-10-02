###############################################
# Workspace frontend, served by nginx
###############################################
# The bundle is built once in runtime mode, so one image runs in every
# environment: render-frontend-config.sh writes config.js from environment
# variables each time the container starts.

ARG PLATFORM=linux/amd64

###############################################
# Builder Image
###############################################
# The build output is static files, so this stage runs on the build host's
# own platform.
FROM --platform=$BUILDPLATFORM node:22 AS builder

ARG BUN_VERSION=1.4.2
ENV NODE_OPTIONS="--max-old-space-size=4608"

RUN npm install -g bun@${BUN_VERSION}

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun scripts/check-runtime-config.ts
RUN bun run build:runtime

###############################################
# Production Image
###############################################
FROM --platform=$PLATFORM nginx:stable-alpine AS production-stage

ENV NGINX_PORT=8080

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 render-frontend-config.sh /docker-entrypoint.d/40-render-frontend-config.sh

# Run as the image's unprivileged nginx user: keep the pid file in /tmp and let
# that user write the paths the entrypoint scripts and nginx write to.
RUN sed -i -e '/^user /d' -e 's|^pid .*|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
    && rm /etc/nginx/conf.d/default.conf \
    && chown -R nginx:nginx /var/cache/nginx /etc/nginx/conf.d /usr/share/nginx/html/config.js

USER nginx

EXPOSE ${NGINX_PORT}
CMD ["nginx", "-g", "daemon off;"]
