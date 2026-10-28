/**
 * App-builder MCP resource catalog.
 *
 * Direct port of workspace_mcp/app_builder/resources.py:40-220. Each entry
 * binds an `workspace://...` URI to a markdown file shipped under
 * `mcp-server/src/resources/app-builder/`.
 *
 * The 16 markdown files (~84 KB total) are eager-loaded at boot since they
 * are static + small. Each `read` returns the cached body — no per-request
 * IO unless we someday move to dynamic content.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getLogger } from "../lib/logger.ts";

const logger = getLogger(["mcp", "resources", "app-builder"]);

const MIME_TYPE = "text/markdown";

interface AppBuilderResource {
  uri: string;
  title: string;
  description: string;
  relativePath: string;
}

const RESOURCES: readonly AppBuilderResource[] = [
  {
    uri: "workspace://app-builder/index",
    title: "App Builder Index",
    description:
      "Router for the FINOS Workspace app-builder resources. Read this " +
      "first to find the right spec, guide, or example. Only for when the " +
      "user has explicitly asked to build, review, debug, or extend a " +
      "backend or app — not for composing dashboards from existing widgets.",
    relativePath: "app-builder-index.md",
  },
  {
    uri: "workspace://overview/what-is-workspace",
    title: "What FINOS Workspace Is",
    description:
      "Mental model of FINOS Workspace from the consumer side — " +
      "Dashboards, Apps (templates), Widgets, Prompts, the AI Agent, " +
      "and what is native vs. what your backend supplies.",
    relativePath: "overview/what-is-workspace.md",
  },
  {
    uri: "workspace://overview/ai-agent-contract",
    title: "AI Agent Contract",
    description:
      "How FINOS Workspace's built-in AI Agent reads widget metadata and data, " +
      "and the description / response-shape rules that make widgets " +
      "agent-friendly.",
    relativePath: "overview/ai-agent-contract.md",
  },
  {
    uri: "workspace://contract/backend",
    title: "Backend Contract",
    description:
      "What a FINOS Workspace backend must expose over HTTP, " +
      "language-agnostic.",
    relativePath: "backend-contract.md",
  },
  {
    uri: "workspace://specs/widgets-json",
    title: "widgets.json Spec",
    description:
      "Top-level shape and critical fields for widgets.json, the widget " +
      "metadata contract.",
    relativePath: "specs/widgets-json.md",
  },
  {
    uri: "workspace://specs/apps-json",
    title: "apps.json Spec",
    description:
      "Served shape, tab/layout structure, and parameter group wiring " +
      "for apps.json.",
    relativePath: "specs/apps-json.md",
  },
  {
    uri: "workspace://specs/widget-types",
    title: "Widget Types",
    description:
      "Catalog of widget type strings and a use-case-to-type quick " +
      "selector.",
    relativePath: "specs/widget-types.md",
  },
  {
    uri: "workspace://specs/widget-parameters",
    title: "Widget Parameters",
    description:
      "Param types (text, number, boolean, date, endpoint), option " +
      "sources, and the type-selection cheatsheet.",
    relativePath: "specs/widget-parameters.md",
  },
  {
    uri: "workspace://specs/layout-grid",
    title: "Layout Grid and Groups",
    description:
      "40-column grid math and tab/group conventions.",
    relativePath: "specs/layout-grid.md",
  },
  {
    uri: "workspace://guides/build-an-app",
    title: "Build an App",
    description:
      "End-to-end workflow for building a new FINOS Workspace app from " +
      "scratch. Only for when the user has explicitly asked to build one.",
    relativePath: "guides/build-an-app.md",
  },
  {
    uri: "workspace://guides/review-app",
    title: "Review an App",
    description:
      "Structured review pass for an existing FINOS Workspace backend " +
      "or app template.",
    relativePath: "guides/review-app.md",
  },
  {
    uri: "workspace://guides/debug-app",
    title: "Debug an App",
    description:
      "Diagnostic order for apps that don't load, widgets that render " +
      "empty, or sync that doesn't propagate.",
    relativePath: "guides/debug-app.md",
  },
  {
    uri: "workspace://guides/convert-endpoint-to-widget",
    title: "Convert an Existing Endpoint to a Widget",
    description:
      "Turn an existing HTTP endpoint into a FINOS Workspace widget — type " +
      "selection, params, columns, validation.",
    relativePath: "guides/convert-endpoint-to-widget.md",
  },
  {
    uri: "workspace://examples/generic-http/minimal",
    title: "Minimal Backend (Generic HTTP)",
    description:
      "Framework-neutral picture of a FINOS Workspace backend — " +
      "routes, response shapes, CORS, auth.",
    relativePath: "examples/generic-http-minimal.md",
  },
  {
    uri: "workspace://examples/python-fastapi/minimal",
    title: "Minimal Backend (Python + FastAPI)",
    description:
      "Recommended Python starter shape for a FINOS Workspace backend " +
      "using FastAPI.",
    relativePath: "examples/python-fastapi-minimal.md",
  },
  {
    uri: "workspace://validation/common-errors",
    title: "Common Errors",
    description:
      "Curated list of the most common widgets.json, apps.json, " +
      "layout, group, and endpoint failures with fixes.",
    relativePath: "validation/common-errors.md",
  },
];

const RESOURCE_DIR = join(import.meta.dirname, "app-builder");

interface CachedResource extends AppBuilderResource {
  body: string;
}

let cache: CachedResource[] | null = null;

async function loadAll(): Promise<CachedResource[]> {
  if (cache !== null) return cache;
  const loaded: CachedResource[] = [];
  for (const r of RESOURCES) {
    const path = join(RESOURCE_DIR, r.relativePath);
    const body = await readFile(path, "utf8");
    loaded.push({ ...r, body });
  }
  cache = loaded;
  logger.info("App-builder resources loaded", {
    count: loaded.length,
    bytes: loaded.reduce((s, r) => s + r.body.length, 0),
  });
  return cache;
}

export async function registerAppBuilderResources(
  mcp: McpServer,
): Promise<void> {
  const all = await loadAll();
  for (const r of all) {
    mcp.registerResource(
      r.title,
      r.uri,
      {
        description: r.description,
        mimeType: MIME_TYPE,
      },
      async () => ({
        contents: [
          {
            uri: r.uri,
            mimeType: MIME_TYPE,
            text: r.body,
          },
        ],
      }),
    );
  }
}

export function listAppBuilderResourceUris(): string[] {
  return RESOURCES.map((r) => r.uri);
}
