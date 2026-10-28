import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface InteropModule {
  id: string;
  name: string;
  wheel: string;
  esm: string;
  css?: string;
  traits: Record<string, unknown>;
}

const pins: {
  wheels: Record<string, { url: string; sha256: string }>;
  modules: InteropModule[];
} = JSON.parse(
  readFileSync(new URL("./interop-modules.json", import.meta.url), "utf8"),
);

export const INTEROP_MODULES = pins.modules;

async function wheel(dir: string, name: string) {
  const pin = pins.wheels[name];
  const path = join(dir, `${name}.whl`);
  const response = await fetch(pin.url);
  if (!response.ok) throw new Error(`${pin.url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== pin.sha256)
    throw new Error(`${name}: SHA-256 ${digest}, pinned ${pin.sha256}`);
  writeFileSync(path, bytes);
  return path;
}

export async function fetchInteropModules(dir: string) {
  mkdirSync(dir, { recursive: true });
  const wheels = new Map<string, string>();
  const files: Record<string, { esm: string; css?: string }> = {};
  for (const module of INTEROP_MODULES) {
    if (!wheels.has(module.wheel))
      wheels.set(module.wheel, await wheel(dir, module.wheel));
    const archive = wheels.get(module.wheel) ?? "";
    const read = (member: string) =>
      execFileSync("unzip", ["-p", archive, member], {
        maxBuffer: 64 * 1024 * 1024,
      }).toString("utf8");
    files[module.id] = {
      esm: read(module.esm),
      ...(module.css ? { css: read(module.css) } : {}),
    };
  }
  return files;
}

export function interopEntry(module: InteropModule) {
  return `const TRAITS = ${JSON.stringify(module.traits)};
let widget;
export default {
  async initialize(context) {
    const [, buffers] = await context.experimental.invoke("core:asset:read", { path: "assets/module.js" });
    const url = URL.createObjectURL(new Blob([buffers[0]], { type: "text/javascript" }));
    try {
      const loaded = await import(url);
      widget = typeof loaded.default === "function" ? await loaded.default() : loaded.default;
    } finally {
      URL.revokeObjectURL(url);
    }
    for (const [name, value] of Object.entries(TRAITS)) context.model.set(name, value);
    return widget.initialize?.(context);
  },
  render(context) {
    return widget.render?.(context);
  },
};
`;
}

export function interopManifest(module: InteropModule) {
  return {
    manifestVersion: 1,
    id: `e2e-interop-${module.id}`,
    name: `Interop ${module.name}`,
    description: "A public Anywidget module, unmodified, in a plugin frame",
    publisher: { name: "FINOS Workspace end-to-end tests" },
    host: { api: 1, afm: "0.11" },
    entry: { module: "entry.js", ...(module.css ? { styles: ["entry.css"] } : {}) },
    contributes: {
      widgets: [
        {
          id: "module",
          name: `Interop ${module.name}`,
          description: "A public Anywidget module",
          category: "E2E interop",
          standalone: true,
          permissions: [],
          grid: { w: 20, h: 14 },
        },
      ],
    },
  };
}
