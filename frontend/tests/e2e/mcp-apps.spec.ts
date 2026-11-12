import { expect, test } from "@playwright/test";

// The MCP App sandbox origin, as the stack serves it. A * stands for one MCP
// server's label, as in MCP_APPS_SANDBOX_URL.
const SANDBOX = process.env.E2E_SANDBOX_URL ?? "https://*.sandbox.localhost:3001";
const SANDBOX_PAGE = "mcp-app-sandbox.html";
const sandboxFor = (label: string) => SANDBOX.replace("*", label).replace(/\/$/, "");
const directLocal = (url: string) =>
  url.replace(/\/\/[^/]*\.sandbox\.localhost/, "//localhost");

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("the MCP App sandbox origin", () => {
  test("builds the page's policy from the declared domains, and drops anything else", async ({
    request,
    baseURL,
  }) => {
    const page = new URL(`${directLocal(sandboxFor("x"))}/${SANDBOX_PAGE}`);
    page.searchParams.set(
      "connect",
      "https://api.example.com https://*.com 'unsafe-eval' https://x.example.com;script-src *",
    );
    page.searchParams.set(
      "resource",
      "https://cdn.example.com https://cdn.example.com/path",
    );

    const response = await request.get(page.toString());
    expect(response.status()).toBe(200);
    const csp = response.headers()["content-security-policy"] ?? "";

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self' https://api.example.com;");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.example.com;");
    expect(csp).toContain(`frame-ancestors ${new URL(baseURL ?? "").origin}`);
    expect(csp).not.toContain("*.com");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp.match(/script-src/g)).toHaveLength(1);
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("serves nothing but the sandbox page", async ({ request }) => {
    const origin = directLocal(sandboxFor("x"));
    for (const path of ["/", "/index.html", "/config.js", "/assets/"]) {
      expect((await request.get(`${origin}${path}`)).status(), path).toBe(404);
    }
  });

  test("relays messages between the app and an opaque view that cannot reach the relay", async ({
    page,
  }) => {
    await page.goto("/");
    const origin = sandboxFor("0123456789abcdef0123456789abcdef");

    const seen = await page.evaluate(
      async ({ origin, pagePath }) => {
        const view = `<script>
          const reachesRelay = (() => { try { return !!parent.document.title || true; } catch { return false; } })();
          parent.postMessage({ jsonrpc: "2.0", method: "view/hello", params: { origin: String(self.origin), reachesRelay } }, "*");
          parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "*");
          addEventListener("message", (event) => {
            if (event.data && event.data.method === "host/ping") {
              parent.postMessage({ jsonrpc: "2.0", method: "view/pong", params: {} }, "*");
            }
          });
        </script>`;

        const frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
        frame.src = `${origin}/${pagePath}`;
        const messages: { method?: string; params?: Record<string, unknown> }[] = [];
        const next = (method: string) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`no ${method}`)), 10_000);
            const check = () => {
              if (messages.some((m) => m.method === method)) {
                clearTimeout(timer);
                resolve();
              } else setTimeout(check, 20);
            };
            check();
          });
        addEventListener("message", (event) => {
          if (event.source === frame.contentWindow && event.origin === origin) {
            messages.push(event.data);
          }
        });
        document.body.append(frame);

        await next("ui/notifications/sandbox-proxy-ready");
        // The host asks for allow-same-origin; the relay must not grant it.
        frame.contentWindow?.postMessage(
          {
            jsonrpc: "2.0",
            method: "ui/notifications/sandbox-resource-ready",
            params: {
              html: view,
              sandbox: "allow-scripts allow-same-origin allow-forms",
            },
          },
          origin,
        );
        await next("view/hello");
        frame.contentWindow?.postMessage(
          { jsonrpc: "2.0", method: "host/ping" },
          origin,
        );
        await next("view/pong");
        return messages;
      },
      { origin, pagePath: SANDBOX_PAGE },
    );

    const hello = seen.find((m) => m.method === "view/hello");
    expect(hello?.params).toEqual({ origin: "null", reachesRelay: false });
    expect(
      seen.filter((m) => m.method === "ui/notifications/sandbox-proxy-ready"),
    ).toHaveLength(1);
    expect(seen.some((m) => m.method === "view/pong")).toBe(true);
  });

  test("refuses to run when it is not framed", async ({ page }) => {
    await page.goto(
      `${sandboxFor("0123456789abcdef0123456789abcdef")}/${SANDBOX_PAGE}`,
    );
    await expect(page.locator("body")).toContainText("refused to start: not framed");
  });
});
