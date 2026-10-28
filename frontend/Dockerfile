# syntax=docker/dockerfile:1

###############################################
# FINOS Workspace frontend, served by nginx
###############################################
# The bundle is built once in runtime mode, so one image runs in every
# environment: nginx renders config.js from environment variables
# (app-config.js). The image is built from scratch: an nginx compiled here,
# its configuration and the bundle. It has no shell, no package manager and no
# shared libraries. The nginx it compiles is for the platform the image is
# built for (docker build --platform, or the service's platform in compose).

###############################################
# Builder Image
###############################################
# The build output is static files, so this stage runs on the build host's
# own platform.
FROM --platform=$BUILDPLATFORM node:22 AS builder

ENV NODE_OPTIONS="--max-old-space-size=4608"

WORKDIR /app
COPY package.json package-lock.json ./
# The packages' own install scripts are not run: the build needs none of them.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN node scripts/check-runtime-config.ts
# nginx renders config.js, so the one the build writes is left out.
RUN npm run build:runtime && rm dist/config.js

###############################################
# nginx
###############################################
# nginx, njs, PCRE2 and zlib from their releases, linked with musl into one
# static binary. It serves plain HTTP behind the load balancer, so it has no
# TLS and no OpenSSL, and njs leaves out the modules that need more libraries.
# Each tarball is checked against its SHA-256; nginx's is a release signed by
# its developers (nginx.org/en/pgp_keys.html).
FROM alpine:3.24.2 AS nginx

ARG NGINX_VERSION=1.31.8
ARG NGINX_SHA256=0652b760b3b772d2ec17b47c2fc15d9a95e6fe35cd5b877eadc1a62d9bc75af1
ARG NJS_VERSION=1.0.2
ARG NJS_SHA256=ff86d2dd6bf7b874f5ade21da9f17837807e39a7b8172bf7cd3c87fd9f8d637e
ARG PCRE2_VERSION=10.49
ARG PCRE2_SHA256=929f0b20e62879252a15886b06c89f1edef61a363cbd5826fb041080a5e557ae
ARG ZLIB_VERSION=1.3.2
ARG ZLIB_SHA256=bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16

RUN apk add --no-cache build-base linux-headers

WORKDIR /src
RUN wget -q "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" \
      "https://github.com/nginx/njs/releases/download/${NJS_VERSION}/njs-${NJS_VERSION}.tar.gz" \
      "https://github.com/PCRE2Project/pcre2/releases/download/pcre2-${PCRE2_VERSION}/pcre2-${PCRE2_VERSION}.tar.gz" \
      "https://github.com/madler/zlib/releases/download/v${ZLIB_VERSION}/zlib-${ZLIB_VERSION}.tar.gz" \
    && printf '%s  %s\n' \
      "$NGINX_SHA256" "nginx-${NGINX_VERSION}.tar.gz" \
      "$NJS_SHA256" "njs-${NJS_VERSION}.tar.gz" \
      "$PCRE2_SHA256" "pcre2-${PCRE2_VERSION}.tar.gz" \
      "$ZLIB_SHA256" "zlib-${ZLIB_VERSION}.tar.gz" \
      | sha256sum -c - \
    && for tarball in *.tar.gz; do tar -xzf "$tarball"; done

# The pid, lock and temporary files go to /tmp, which the unprivileged user can
# write, and the logs to the container's output.
RUN cd "nginx-${NGINX_VERSION}" \
    && NJS_QUICKJS=NO NJS_OPENSSL=NO NJS_LIBXSLT=NO NJS_ZLIB=NO ./configure \
      --prefix=/etc/nginx \
      --sbin-path=/usr/sbin/nginx \
      --conf-path=/etc/nginx/nginx.conf \
      --pid-path=/tmp/nginx.pid \
      --lock-path=/tmp/nginx.lock \
      --error-log-path=/dev/stderr \
      --http-log-path=/dev/stdout \
      --http-client-body-temp-path=/tmp/client_body \
      --http-proxy-temp-path=/tmp/proxy \
      --http-fastcgi-temp-path=/tmp/fastcgi \
      --http-uwsgi-temp-path=/tmp/uwsgi \
      --http-scgi-temp-path=/tmp/scgi \
      --user=nginx \
      --group=nginx \
      --with-pcre="../pcre2-${PCRE2_VERSION}" \
      --with-pcre-jit \
      --with-zlib="../zlib-${ZLIB_VERSION}" \
      --add-module="../njs-${NJS_VERSION}/nginx" \
      --without-http_proxy_module \
      --without-http_fastcgi_module \
      --without-http_uwsgi_module \
      --without-http_scgi_module \
      --without-http_grpc_module \
      --without-http_memcached_module \
      --without-http_ssi_module \
      --without-http_userid_module \
      --without-http_autoindex_module \
      --without-http_mirror_module \
      --without-http_empty_gif_module \
      --without-http_browser_module \
      --without-http_split_clients_module \
      --with-cc-opt="-O2 -static" \
      --with-ld-opt="-static" \
    && make -j"$(nproc)"

# The image's whole filesystem, but for the configuration and the bundle. The
# CycloneDX file names what is compiled into the binary: the image has no
# package database, and SBOM scanners read the file (.github/actions/image-sbom).
RUN set -e; \
    mkdir -p /rootfs/usr/sbin /rootfs/etc/nginx /rootfs/usr/share/sbom /rootfs/tmp; \
    cp "nginx-${NGINX_VERSION}/objs/nginx" /rootfs/usr/sbin/nginx; \
    strip /rootfs/usr/sbin/nginx; \
    cp "nginx-${NGINX_VERSION}/conf/mime.types" /rootfs/etc/nginx/mime.types; \
    chmod 1777 /rootfs/tmp; \
    echo 'nginx:x:101:101:nginx:/nonexistent:/sbin/nologin' > /rootfs/etc/passwd; \
    echo 'nginx:x:101:' > /rootfs/etc/group; \
    musl=$(ldd 2>&1 | sed -n 's/^Version //p'); \
    component() { \
      printf '{"type": "%s", "name": "%s", "version": "%s", "purl": "pkg:generic/%s@%s", "cpe": "cpe:2.3:a:%s:%s:%s:*:*:*:*:*:*:*", "licenses": [{"expression": "%s"}]}' \
        "$1" "$2" "$3" "$2" "$3" "$4" "$2" "$3" "$5"; \
    }; \
    printf '{"bomFormat": "CycloneDX", "specVersion": "1.6", "version": 1, "components": [%s, %s, %s, %s, %s]}\n' \
      "$(component application nginx "$NGINX_VERSION" f5 BSD-2-Clause)" \
      "$(component library njs "$NJS_VERSION" f5 BSD-2-Clause)" \
      "$(component library pcre2 "$PCRE2_VERSION" pcre "BSD-3-Clause WITH PCRE2-exception")" \
      "$(component library zlib "$ZLIB_VERSION" zlib Zlib)" \
      "$(component library musl "$musl" musl-libc MIT)" \
      > /rootfs/usr/share/sbom/nginx.cdx.json

###############################################
# Production Image
###############################################
FROM scratch AS production-stage

COPY --from=nginx /rootfs/ /
COPY nginx.conf /etc/nginx/nginx.conf
COPY app-config.js /etc/nginx/njs/app-config.js
COPY --from=builder /app/dist /usr/share/nginx/html

# The image's unprivileged nginx user (/etc/passwd above).
USER 101:101

EXPOSE 8080
STOPSIGNAL SIGQUIT
CMD ["/usr/sbin/nginx"]
