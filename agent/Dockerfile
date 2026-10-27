# syntax=docker/dockerfile:1

FROM chimeralinux/chimera@sha256:29102d7e12a1f464707d7aba19ce53e652d277861838ed4129178d0655444b1a AS node-build

ARG NODE_VERSION=26.12.1
ARG NODE_SHA256=053e3b296859b6d8d93f99ef97fa9cec1c4ee171c72968100c649978c1dbd38c

ENV CC=clang CXX=clang++

RUN apk upgrade --no-cache --available \
    && apk add --no-cache clang musl-devel linux-headers pkgconf python ninja gmake rust cargo curl bsdtar \
      llvm-binutils openssl3-devel icu-devel tzdb

RUN set -e; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}.tar.xz"; \
    echo "$NODE_SHA256  node-v${NODE_VERSION}.tar.xz" | sha256sum -c -; \
    bsdtar -xf "node-v${NODE_VERSION}.tar.xz"; \
    cd "node-v${NODE_VERSION}"; \
    CFLAGS="-fstack-protector-strong -fstack-clash-protection" \
    CXXFLAGS="-fstack-protector-strong -fstack-clash-protection" \
    LDFLAGS="-pie -Wl,-z,relro,-z,now,-z,noexecstack" \
      ./configure --ninja --prefix=/usr/local --without-npm --with-intl=system-icu --shared-openssl; \
    ninja -C out/Release node; \
    mkdir -p /rootfs/usr/local/bin /rootfs/usr/local/share/licenses/node; \
    llvm-strip -o /rootfs/usr/local/bin/node out/Release/node; \
    cp LICENSE /rootfs/usr/local/share/licenses/node/LICENSE; \
    cd /; rm -rf "node-v${NODE_VERSION}" "node-v${NODE_VERSION}.tar.xz"

RUN set -e; \
    mkdir -p /rootfs/usr/lib /rootfs/usr/share/sbom /rootfs/etc /rootfs/tmp; \
    ln -s usr/lib /rootfs/lib; \
    ln -s libc.so "/rootfs/usr/lib/ld-musl-$(uname -m).so.1"; \
    bsdtar -cf - -C /usr/share zoneinfo | bsdtar -xpf - -C /rootfs/usr/share; \
    chmod 1777 /rootfs/tmp; \
    printf '%s\n' \
      'root:x:0:0:root:/root:/sbin/nologin' \
      'nobody:x:65534:65534:nobody:/nonexistent:/sbin/nologin' \
      'node:x:1000:1000:node:/app:/sbin/nologin' > /rootfs/etc/passwd; \
    printf '%s\n' 'root:x:0:' 'nobody:x:65534:' 'node:x:1000:' > /rootfs/etc/group
RUN python3 - <<'EOF'
import json, pathlib, platform, re, shutil, subprocess, sys

root = pathlib.Path("/rootfs")
lib = root / "usr/lib"
node = root / "usr/local/bin/node"

def run(*args, check=True):
    return subprocess.run(args, capture_output=True, text=True, check=check).stdout

def needed(path):
    return re.findall(r"\(NEEDED\)\s+Shared library: \[(.+?)\]", run("llvm-readelf", "-d", str(path)))

copied = {}

def link(queue):
    while queue:
        name = queue.pop()
        if name in copied:
            continue
        real = (pathlib.Path("/usr/lib") / name).resolve(strict=True)
        shutil.copy2(real, lib / real.name)
        if real.name != name:
            (lib / name).symlink_to(real.name)
        copied[name] = real
        queue += needed(real)

link(needed(node))
modules = []
(lib / "ossl-modules").mkdir()
for module in sorted(pathlib.Path("/usr/lib/ossl-modules").glob("*.so")):
    shutil.copy2(module, lib / "ossl-modules" / module.name)
    modules.append(module)
    link(needed(module))
if any(name.startswith("libicudata") for name in copied):
    shutil.copytree("/usr/share/icu", root / "usr/share/icu", symlinks=True)

shipped = [node] + [lib / real.name for real in copied.values()] + [lib / "ossl-modules" / m.name for m in modules]
gcc_runtime = re.compile(r"lib(gcc_s|stdc\+\+|atomic|gomp|quadmath|ssp|itm|gfortran|[altu]san)\.so")
gcc = [f"{p}: {name}" for p in shipped for name in [p.name, *needed(p)] if gcc_runtime.match(name)]
if gcc:
    sys.exit("GCC's runtime libraries, or files linked to them:\n" + "\n".join(gcc))

elf = run("llvm-readelf", "--file-header", "--program-headers", "--dynamic", "--dyn-syms", str(node))
stack = next(line for line in elf.splitlines() if "GNU_STACK" in line)
unhardened = [what for what, ok in [
    ("position-independent (PIE)", re.search(r"Type:\s+DYN", elf)),
    ("full RELRO", "GNU_RELRO" in elf and "BIND_NOW" in elf),
    ("a stack that does not execute", " RW " in stack and " RWE " not in stack),
    ("the stack protector", "__stack_chk_fail" in elf),
] if not ok]
if unhardened:
    sys.exit("Node is not built " + ", ".join(unhardened))

def component(name, version, licence, purl=None, cpe=None, **properties):
    c = {"type": "library", "name": name, "licenses": [{"expression": licence}]}
    if version:
        c["version"] = version
        c["purl"] = purl or f"pkg:generic/{name}@{version}"
        if cpe:
            c["cpe"] = f"cpe:2.3:a:{cpe}:{version.split('-r')[0]}:*:*:*:*:*:*:*"
    if properties:
        c["properties"] = [{"name": k.replace("_", "-"), "value": v} for k, v in properties.items()]
    return c

def chimera(path):
    pkgver = re.search(r"is owned by (\S+)", run("apk", "info", "--who-owns", str(path))).group(1)
    name, version = re.fullmatch(r"(.+)-([^-]+-r\d+)", pkgver).groups()
    licence = re.search(rf"^{re.escape(pkgver)} \S+ \{{\S+\}} \((.*)\) \[installed\]$", run("apk", "list", "-I", name), re.M).group(1)
    return name, version, licence

cpes = {"musl": "musl-libc:musl", "openssl3-libs": "openssl:openssl", "icu-libs": "unicode:international_components_for_unicode"}
packages = sorted({chimera(path) for path in [pathlib.Path("/usr/lib") / name for name in copied] + modules})
components = [component(name, version, licence, f"pkg:apk/chimera/{name}@{version}?arch={platform.machine()}", cpes.get(name))
              for name, version, licence in packages]
musl = next(f"musl {version}" for name, version, _ in packages if name == "musl")
components.append(component("mimalloc", None, "MIT", compiled_into=musl))

versions = json.loads(run(str(node), "-p", "JSON.stringify(process.versions)"))
linked = {"openssl", "icu", "cldr", "tz", "unicode", "modules", "napi"}
licences = {"v8": "BSD-3-Clause", "uv": "MIT", "zlib": "Zlib", "brotli": "MIT", "ares": "MIT", "nghttp2": "MIT",
            "acorn": "MIT", "ada": "MIT", "amaro": "MIT", "libffi": "MIT", "lief": "Apache-2.0", "llhttp": "MIT",
            "merve": "MIT", "nbytes": "MIT", "ncrypto": "MIT", "nghttp3": "MIT", "ngtcp2": "MIT", "simdjson": "Apache-2.0",
            "simdutf": "MIT", "sqlite": "blessing", "undici": "MIT", "uvwasi": "MIT", "zstd": "BSD-3-Clause"}
unknown = sorted(set(versions) - linked - set(licences) - {"node"})
if unknown:
    sys.exit(f"Node reports libraries compiled into it that have no licence here: {', '.join(unknown)}")
in_node = {"compiled-into": f"node {versions['node']}"}
components.append(component("node", versions["node"], "MIT", f"pkg:generic/node@{versions['node']}", "nodejs:node.js"))
components += [component(name, versions[name], licence, **in_node) for name, licence in licences.items() if versions.get(name)]
components += [component("swc", None, "Apache-2.0", **in_node), component("hdr-histogram", None, "BSD-2-Clause", **in_node),
               component("siphash", None, "CC0-1.0", **in_node)]
tzdb = chimera(pathlib.Path("/usr/share/zoneinfo/UTC"))
components.append(component(tzdb[0], tzdb[1], "LicenseRef-Public-Domain", f"pkg:apk/chimera/{tzdb[0]}@{tzdb[1]}", "iana:tzdata"))
sbom = {"bomFormat": "CycloneDX", "specVersion": "1.6", "version": 1, "components": components}
(root / "usr/share/sbom/runtime.cdx.json").write_text(json.dumps(sbom, indent=2) + "\n")
EOF

FROM scratch AS node

COPY --from=node-build /rootfs/ /

FROM scratch AS deps

COPY --from=node / /
ADD --unpack=true --checksum=sha256:d1a92f40e6c407b84c3a00c3cf978a10b24fd42f153c527e2016cef7bb34a483 \
  https://registry.npmjs.org/npm/-/npm-11.20.0.tgz /opt/npm/

ENV PATH=/usr/local/bin:/usr/bin:/bin

WORKDIR /app

COPY package.json package-lock.json ./
RUN ["node", "/opt/npm/package/bin/npm-cli.js", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]

FROM scratch AS ines-mcp

COPY --from=node / /

ENV PATH=/usr/local/bin:/usr/bin:/bin
ENV NODE_ENV=production
ENV MCP_PORT=8787

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY mcp-server ./mcp-server
COPY src/lib/logging.ts src/lib/env-reference.ts src/lib/redact.ts src/lib/metrics.ts src/lib/scope.ts src/lib/safe-fetch.ts src/lib/isolate.ts src/lib/isolate-protocol.ts src/lib/isolate-child.ts src/lib/zip-guard.ts src/lib/bounded-cache.ts src/lib/html-page.ts src/lib/html-child.ts src/lib/page-text.ts src/lib/page-view.ts ./src/lib/

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "const port = process.env.MCP_PORT || '8787'; const res = await fetch(`http://127.0.0.1:${port}/`); if (!res.ok) process.exit(1);"]

USER 1000:1000

CMD ["node", "mcp-server/src/server.ts"]

FROM scratch AS ines

COPY --from=node / /

ENV PATH=/usr/local/bin:/usr/bin:/bin
ENV NODE_ENV=production
ENV PORT=7777

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

ARG GIT_SHA=dev
ENV OTEL_SERVICE_VERSION=$GIT_SHA

EXPOSE 7777

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "const port = process.env.PORT || '7777'; const res = await fetch(`http://127.0.0.1:${port}/status`); if (!res.ok) process.exit(1);"]

USER 1000:1000

CMD ["node", "src/server.ts"]
