import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { shellHash } from "~/plugins/frame";

type Headers = { enforce: string; reportOnly: string; error?: string };
type AppConfig = {
  PLUGIN_SHELL_HASH: string;
  policy(env: Record<string, string>): string;
  headers(env: Record<string, string>): Headers;
  sandboxPolicy(args: Record<string, string>, env: Record<string, string>): string;
};

const appConfig: AppConfig = (
  await import(pathToFileURL(resolve(process.cwd(), "app-config.js")).href)
).default;

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...sources] = part.split(" ");
      return [name, sources];
    }),
  );
}

const LOCAL = {
  BACKEND_URL: "http://localhost:8000",
  AI_API_URL: "http://localhost:7777/v1",
};

describe("the web app's Content-Security-Policy", () => {
  it("allows only the app's own scripts, the plugin shell and blob: when HTML widgets run no scripts", () => {
    const policy = directives(appConfig.policy(LOCAL));
    expect(policy["script-src"]).toEqual([
      "'self'",
      "'unsafe-eval'",
      "'wasm-unsafe-eval'",
      "blob:",
      appConfig.PLUGIN_SHELL_HASH,
    ]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'self'"]);
    expect(policy["worker-src"]).toEqual(["'self'", "blob:"]);
  });

  it("names the plugin shell by the hash the plugin frames use", async () => {
    expect(appConfig.PLUGIN_SHELL_HASH).toBe(`'${await shellHash()}'`);
  });

  it("lets HTML widgets run their scripts only when the deployment allows it", () => {
    const policy = directives(
      appConfig.policy({ ...LOCAL, ALLOW_HTML_JS_EXECUTION: "true" }),
    );
    expect(policy["script-src"]).toContain("'unsafe-inline'");
    expect(policy["script-src"]).toContain("https:");
    expect(policy["script-src"]).not.toContain(appConfig.PLUGIN_SHELL_HASH);
  });

  it("reaches the API and the agent by origin, and the API's sockets", () => {
    const policy = directives(appConfig.policy(LOCAL));
    expect(policy["connect-src"]).toEqual(
      expect.arrayContaining([
        "http://localhost:8000",
        "ws://localhost:8000",
        "http://localhost:7777",
      ]),
    );
    expect(policy["frame-src"]).toContain("http://localhost:8000");
    expect(appConfig.policy({ BACKEND_URL: "", AI_API_URL: "/agent" })).not.toMatch(
      /null|undefined/,
    );
  });

  it("allows Google's sign-in only when Google is an identity provider", () => {
    expect(appConfig.policy(LOCAL)).not.toContain("accounts.google.com");
    const policy = directives(
      appConfig.policy({
        ...LOCAL,
        AUTHENTICATION_IDENTITY_PROVIDERS: "microsoft, Google",
      }),
    );
    expect(policy["script-src"]).toContain("https://accounts.google.com/gsi/client");
    expect(policy["frame-src"]).toContain("https://accounts.google.com/gsi/");
  });

  it("allows the white-label images and stylesheet where they are hosted", () => {
    const policy = directives(
      appConfig.policy({
        WL_LOGIN_IMAGE: "http://brand.internal/login.png",
        WL_STYLESHEET: "https://cdn.example.com/theme.css",
      }),
    );
    expect(policy["img-src"]).toContain("http://brand.internal");
    expect(policy["style-src"]).toContain("https://cdn.example.com");
  });

  it("adds the deployment's extra sources to their directives", () => {
    const policy = directives(
      appConfig.policy({
        CSP_EXTRA_SOURCES:
          "script-src https://cdn.plugins.example.com;  frame-ancestors https://portal.example.com ; connect-src http://localhost:9000",
      }),
    );
    expect(policy["script-src"]).toContain("https://cdn.plugins.example.com");
    expect(policy["frame-ancestors"]).toEqual(["'self'", "https://portal.example.com"]);
    expect(policy["connect-src"]).toContain("http://localhost:9000");
  });

  it.each([
    ["a directive the policy does not set", "sandbox allow-scripts"],
    ["'none', which would empty a directive", "script-src 'none'"],
    ["a quoted keyword it does not know", "script-src 'strict-dynamic'"],
    ["a source that smuggles a directive", 'img-src https://a.example.com"'],
    ["a comma", "img-src https://a.example.com,https://b.example.com"],
  ])("fails closed on %s", (_name, extra) => {
    const result = appConfig.headers({ CSP_EXTRA_SOURCES: extra });
    expect(result.enforce).toBe("default-src 'none'");
    expect(result.reportOnly).toBe("");
    expect(result.error).toMatch(/CSP_EXTRA_SOURCES/);
  });

  it("sends the policy as report-only when asked, and refuses anything but true or false", () => {
    const reportOnly = appConfig.headers({ ...LOCAL, CSP_REPORT_ONLY: "true" });
    expect(reportOnly.enforce).toBe("");
    expect(reportOnly.reportOnly).toContain("script-src 'self'");
    expect(appConfig.headers({ ...LOCAL, CSP_REPORT_ONLY: "false" }).reportOnly).toBe(
      "",
    );
    expect(appConfig.headers({ CSP_REPORT_ONLY: "yes" }).enforce).toBe(
      "default-src 'none'",
    );
  });

  it("is sent from every nginx location that sets its own headers", () => {
    const conf = readFileSync(resolve(process.cwd(), "nginx.conf"), "utf8");
    const blocks = conf.split(/\n\s*location /).slice(1);
    const isSandbox = (text: string) => text.startsWith("= /mcp-app-sandbox.html");
    for (const block of blocks.filter(
      (text) => text.includes("add_header") && !isSandbox(text),
    )) {
      expect(block).toContain(
        "add_header Content-Security-Policy $content_security_policy always;",
      );
      expect(block).toContain(
        "add_header Content-Security-Policy-Report-Only $content_security_policy_report_only always;",
      );
    }
    expect(conf).toContain(
      "js_set $content_security_policy app_config.contentSecurityPolicy;",
    );
  });

  it("gives the MCP App sandbox page its own policy and never the app's", () => {
    const conf = readFileSync(resolve(process.cwd(), "nginx.conf"), "utf8");
    const block = conf
      .split(/\n\s*location /)
      .find((text) => text.startsWith("= /mcp-app-sandbox.html"));
    expect(block).toContain(
      "add_header Content-Security-Policy $mcp_app_sandbox_csp always;",
    );
    expect(block).not.toContain("$content_security_policy ");
  });

  it("lets the app frame the MCP App sandbox, one origin per server when the address has a *", () => {
    const perServer = directives(
      appConfig.policy({
        ...LOCAL,
        MCP_APPS_SANDBOX_URL: "http://*.sandbox.localhost:3001/",
      }),
    );
    expect(perServer["frame-src"]).toContain("http://*.sandbox.localhost:3001");
    const shared = directives(
      appConfig.policy({
        ...LOCAL,
        MCP_APPS_SANDBOX_URL: "https://mcp-sandbox.example.net",
      }),
    );
    expect(shared["frame-src"]).toContain("https://mcp-sandbox.example.net");
  });

  it.each([
    ["a wildcard over a whole top-level domain", "https://*.net"],
    ["a scheme other than http or https", "javascript://*.example.net"],
    ["a wildcard that is not the leftmost label", "https://sandbox.*.example.net"],
  ])("frames no sandbox for %s", (_name, url) => {
    const policy = directives(
      appConfig.policy({ ...LOCAL, MCP_APPS_SANDBOX_URL: url }),
    );
    expect(policy["frame-src"].join(" ")).not.toContain(url.replace(/\/$/, ""));
    expect(policy["frame-src"]).not.toContain("https://*.net");
  });

  it("serves .mjs files, such as the bundled pdf.js worker, as JavaScript", () => {
    const conf = readFileSync(resolve(process.cwd(), "nginx.conf"), "utf8");
    expect(conf).toMatch(
      /location ~ \\\.mjs\$ \{\s*types \{\}\s*default_type text\/javascript;/,
    );
  });
});

describe("the MCP App sandbox Content-Security-Policy", () => {
  const ENV = { MCP_APPS_HOST_ORIGINS: "https://workspace.example.com" };

  it("denies everything the app did not declare", () => {
    const csp = appConfig.sandboxPolicy({}, ENV);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors https://workspace.example.com");
  });

  it("adds declared domains to the matching directives only", () => {
    const csp = appConfig.sandboxPolicy(
      {
        connect: "https://api.example.com wss://stream.example.com",
        resource: "https://cdn.example.com https://*.fonts.example.net",
        frame: "https://embed.example.com",
        base: "https://base.example.com",
      },
      ENV,
    );
    expect(csp).toContain(
      "connect-src 'self' https://api.example.com wss://stream.example.com",
    );
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' https://cdn.example.com https://*.fonts.example.net",
    );
    expect(csp).toContain("frame-src https://embed.example.com");
    expect(csp).toContain("base-uri 'self' https://base.example.com");
    expect(csp).not.toMatch(/connect-src[^;]*cdn\.example\.com/);
  });

  it("drops sources that are not plain origins instead of passing them through", () => {
    const csp = appConfig.sandboxPolicy(
      {
        connect:
          "* 'unsafe-eval' data: https://ok.example.com https://x.com;script-src javascript:alert(1)",
        resource: "https: https://good.example.com/path",
      },
      ENV,
    );
    expect(csp).toContain("connect-src 'self' https://ok.example.com;");
    expect(csp).not.toContain("x.com");
    expect(csp).not.toContain("javascript:");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/(script|img)-src[^;]* https:( |;|$)/);
    expect(csp).not.toContain("good.example.com/path");
    // a smuggled ";" must not start a directive of its own
    expect(csp.match(/script-src/g)).toHaveLength(1);
  });

  it("drops a wildcard over a whole top-level domain, which would reach every site under it", () => {
    const csp = appConfig.sandboxPolicy(
      {
        connect: "https://*.com wss://*.io https://*.api.example.com",
        resource: "https://*.net https://*.cdn.example.net",
      },
      ENV,
    );
    expect(csp).toContain("connect-src 'self' https://*.api.example.com;");
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' https://*.cdn.example.net;",
    );
    expect(csp).not.toMatch(/\*\.(com|io|net)( |;|$)/);
  });

  it("reduces each host address to its origin, so a trailing slash does not lock everyone out", () => {
    const csp = appConfig.sandboxPolicy(
      {},
      {
        MCP_APPS_HOST_ORIGINS:
          "https://workspace.example.com/ http://localhost:3000/app?x=1",
      },
    );
    expect(csp).toContain(
      "frame-ancestors https://workspace.example.com http://localhost:3000",
    );
  });

  it("refuses to be framed when no valid host origin is configured", () => {
    expect(
      appConfig.sandboxPolicy({}, { MCP_APPS_HOST_ORIGINS: "javascript:alert(1) *" }),
    ).toContain("frame-ancestors 'none'");
  });
});
