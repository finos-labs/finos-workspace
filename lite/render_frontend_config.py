#!/usr/bin/env python3
"""Writes the web app's config.js at container start.

The app reads window.__APP_CONFIG__ from /config.js before it loads. The image keeps the
config.js that the build wrote, and config.env.json, which names the environment variable
of every setting (both come from the app: see frontend/src/lib/runtimeConfigSchema.ts).
Any of those variables that the container was started with replaces its setting; the rest
keep the value they were built with. The values go in as text: the app coerces "true" and
"false", comma-separated lists and JSON itself, and fills in anything that is missing.
"""
import json
import os
import sys

SHARE = os.environ.get("CONFIG_SHARE", "/usr/local/share/workspace")
OUT = os.environ.get("CONFIG_OUT", "/usr/share/nginx/html/config.js")
PREFIX = "window.__APP_CONFIG__ = "


def main() -> None:
    with open(os.path.join(SHARE, "config.js")) as f:
        config = json.loads(f.read().strip().removeprefix(PREFIX).removesuffix(";"))
    with open(os.path.join(SHARE, "config.env.json")) as f:
        names = json.load(f)

    known = set()
    for group, fields in names.items():
        for field, name in fields.items():
            known.add(name)
            if name in os.environ:
                config.setdefault(group, {})[field] = os.environ[name]

    for name in sorted(n for n in os.environ if n.startswith("VITE_") and n not in known):
        print(f"[render_frontend_config] {name} is not a setting of the web app; ignoring it.", file=sys.stderr)

    with open(OUT, "w") as f:
        f.write(f"{PREFIX}{json.dumps(config, indent=2)};\n")


main()
