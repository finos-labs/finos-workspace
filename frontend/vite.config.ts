import { writeFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { loadEnv, type PluginOption } from "vite";
import { Mode, plugin as mdPlugin } from "vite-plugin-markdown";
import { VitePWA } from "vite-plugin-pwa";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";
import { dark } from "./src/components/ds/colors.ts";
import { configFromEnv } from "./src/lib/runtimeConfigSchema.ts";

// plugin so it always forces reload because hmr breaks the dev app
const fullReloadAlways: PluginOption = {
  name: "full-reload-always",
  handleHotUpdate({ server }) {
    server.ws.send({ type: "full-reload" });
    return [];
  },
} as PluginOption;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // we need to do this so we can use the env variables in the config

  const APP_NAME = env.VITE_WL_NAME;
  const APP_DESCRIPTION =
    env.VITE_WL_DESCRIPTION || configFromEnv({}).whiteLabel.description;
  const APP_SHORT_NAME = env.VITE_WL_SHORT_NAME;

  // Runtime builds load config.js before the bundle, so that window.__APP_CONFIG__ is set when
  // the app starts. Other builds and the dev server read the VITE_* variables instead.
  const injectConfigScriptPlugin: PluginOption = {
    name: "inject-config-script",
    transformIndexHtml: {
      order: "post",
      handler() {
        if (mode !== "runtime") return;
        return [{ tag: "script", attrs: { src: "/config.js" }, injectTo: "head-prepend" }];
      },
    },
  };

  // Writes config.js from the .env variables, for runtime builds. Operators edit dist/config.js
  // at deploy time to customise without rebuilding. It uses the app's own schema, so defaults
  // and coercion ("true" → true) are always in sync.
  const generateRuntimeConfigPlugin: PluginOption = {
    name: "generate-runtime-config",
    writeBundle(options) {
      if (mode !== "runtime") return;

      const outDir = options.dir ?? path.resolve("dist");
      writeFileSync(
        path.join(outDir, "config.js"),
        `window.__APP_CONFIG__ = ${JSON.stringify(configFromEnv(env), null, 2)};\n`,
      );
    },
  };

  return {
    server: {
      port: 1420,
      strictPort: true,
    },
    optimizeDeps: {
      rolldownOptions: {
        resolve: {
          conditionNames: ["import", "module", "browser", "default"],
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 10000,
      rolldownOptions: {
        output: {
          manualChunks: (id) => {
            if (!id.includes("node_modules")) return;
            const parts = id.split("node_modules/")[1].split("/");
            const pkg = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];

            if (pkg.startsWith("@azure/") || pkg.startsWith("@okta/"))
              return "vendor-auth";
            if (pkg.startsWith("@wooorm/")) return "vendor-starry-night";
          },
          entryFileNames: "[name].[hash].js",
          chunkFileNames: "[name].[hash].js",
          assetFileNames: "[name].[hash].[ext]",
        },
      },
      target: "esnext",
      minify: "oxc",
    },
    resolve: {
      alias: [
        { find: "~", replacement: path.resolve(import.meta.dirname, "src") },
      ],
    },
    html: { cspNonce: "VITE_NONCE" },
    worker: { format: "es" },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./vitest.setup.ts",
      exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**"],
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
        exclude: [
          "**/*.test.ts",
          "**/*.test.tsx",
          "**/*.spec.ts",
          "**/*.spec.tsx",
          "**/*config*",
          "**/coverage/**",
        ],
      },
      alias: [
        {
          find: /^react-pdf$/,
          replacement: path.resolve(import.meta.dirname, "tests/mocks/react-pdf.tsx"),
        },
      ],
    },
    plugins: [
      react(),
      VitePWA({
        selfDestroying: true,
        registerType: "autoUpdate",
        devOptions: { enabled: false },
        workbox: {
          cacheId: "workspace",
          maximumFileSizeToCacheInBytes: 15000000, // 15mb
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkOnly",
            },
          ],
        },
        manifest: {
          // https://web.dev/articles/add-manifest
          name: APP_NAME,
          short_name: APP_SHORT_NAME,
          description: APP_DESCRIPTION,
          theme_color: dark[900],
          background_color: dark[900],
          display: "fullscreen",
          orientation: "portrait",
          start_url: "/",
          icons: [
            {
              src: "/logo.svg",
              type: "image/svg+xml",
              sizes: "any",
              purpose: "any",
            },
            {
              src: "/icons/android/android-launchericon-192-192.png",
              type: "image/png",
              sizes: "192x192",
              purpose: "any",
            },
            {
              src: "/icons/android/android-launchericon-512-512.png",
              type: "image/png",
              sizes: "512x512",
              purpose: "any",
            },
            {
              src: "/icons/android/android-launchericon-maskable-512.png",
              type: "image/png",
              sizes: "512x512",
              purpose: "maskable",
            },
          ],
        },
      }),
      mdPlugin({ mode: [Mode.MARKDOWN, Mode.REACT] }),
      viteStaticCopy({
        targets: [
          {
            src: ["./src/lib/widgets.json"],
            dest: "assets/data",
          },
          {
            src: "./node_modules/vscode-oniguruma/release/onig.wasm",
            dest: "assets/wasm",
          },
        ],
      }),
      fullReloadAlways,
      injectConfigScriptPlugin,
      generateRuntimeConfigPlugin,
    ],
  };
});
