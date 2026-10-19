/*
 * DuckDB-WASM in the widget's frame, for completion.
 *
 * DuckDB runs in a worker of the frame's own; a suggestion is a message to it and back, a
 * few milliseconds. Its worker script, its WebAssembly binary (the exception-handling
 * build, which every current browser runs) and the extensions it would otherwise download
 * on first use (autocomplete, where sql_auto_complete lives, and json) are package assets.
 * The frame asks the host for them (core:asset:read) the first time the editor is used, so
 * a dashboard that only shows results never loads them. All become blob: URLs: the frame's
 * policy allows blob: workers, and the plugin declares 'wasm-unsafe-eval' and connect-src
 * blob: so the worker can compile what it reads. Nothing is fetched from the network.
 */

import { AsyncDuckDB, getPlatformFeatures, VoidLogger } from "@duckdb/duckdb-wasm";
import { completerFor, EXTENSIONS } from "./completion.js";

export const WASM_ASSET = "assets/duckdb-eh.wasm";
export const WORKER_ASSET = "assets/duckdb-browser-eh.worker.js";
export const extensionAsset = (name) => `assets/${name}.duckdb_extension.wasm`;

/**
 * The worker's first lines. DuckDB-WASM asks `runtime.whereToLoad(name)` where an extension
 * comes from, by its name or its repository URL: a packaged one from its blob: URL,
 * anything else from nowhere. Then DuckDB's own worker script runs, unchanged.
 */
export function bootstrap(workerUrl, extensionUrls) {
  return [
    `const packaged = ${JSON.stringify(extensionUrls)};`,
    "self.runtime = {",
    '  whereToLoad: (name) => packaged[String(name).split("/").pop().split(".")[0]] ?? "",',
    "};",
    `importScripts(${JSON.stringify(workerUrl)});`,
  ].join("\n");
}

/** A Completer once DuckDB is running. `readAsset(path)` gives the bytes of a package asset. */
export async function startCompleter(readAsset) {
  const features = await getPlatformFeatures();
  if (!features.wasmExceptions) throw new Error("this browser has no WebAssembly exceptions");
  const [wasm, worker, ...extensions] = await Promise.all(
    [WASM_ASSET, WORKER_ASSET, ...EXTENSIONS.map(extensionAsset)].map(readAsset),
  );
  const urls = [];
  const blobUrl = (bytes, type) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    urls.push(url);
    return url;
  };
  const wasmUrl = blobUrl(wasm, "application/wasm");
  // DuckDB names an extension after the last segment of where it loads from, and a blob:
  // URL ends in a random id; the fragment, which the request leaves out, gives the name
  const extensionUrls = Object.fromEntries(
    EXTENSIONS.map((name, i) => [name, `${blobUrl(extensions[i], "application/wasm")}#/${name}.duckdb_extension.wasm`]),
  );
  const workerUrl = blobUrl(bootstrap(blobUrl(worker, "text/javascript"), extensionUrls), "text/javascript");
  try {
    const db = new AsyncDuckDB(new VoidLogger(), new Worker(workerUrl));
    await db.instantiate(wasmUrl);
    await db.open({});
    return await completerFor(await db.connect());
  } finally {
    // The worker has read everything it needs by now
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
