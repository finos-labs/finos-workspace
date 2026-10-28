import { describe, expect, it } from "vitest";
import { compose } from "~/plugins/csp";
import { buildSrcdoc, canaryProbes, FRAME_SANDBOX, shellHash } from "~/plugins/frame";
import { GuestMessageSchema } from "~/plugins/protocol";
import shellSource from "~/plugins/shell/shell.js?raw";

async function sha256Base64(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Buffer.from(digest).toString("base64");
}

describe("the plugin frame document", () => {
  it("is sandboxed with allow-scripts only", () => {
    expect(FRAME_SANDBOX).toBe("allow-scripts");
  });

  it("starts with the policy and carries the shell whose hash the policy allows", async () => {
    const doc = await buildSrcdoc(compose({}), "dark");
    const head = doc.slice(doc.indexOf("<head>") + 6);
    expect(head.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc).toContain(`<script>${shellSource}</script>`);
    const hash = await shellHash();
    expect(hash).toBe(`sha256-${await sha256Base64(shellSource)}`);
    expect(doc).toContain(`script-src &#39;${hash}&#39;`.replace(/&#39;/g, "'"));
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("connect-src 'none'");
  });

  it("has exactly one script, so nothing else in the document can run", async () => {
    const doc = await buildSrcdoc(compose({}), "dark");
    expect(doc.match(/<script/g)).toHaveLength(1);
    expect(shellSource).not.toContain("</script");
  });

  it("takes the host's color scheme, so the browser keeps the frame transparent", async () => {
    expect(await buildSrcdoc(compose({}), "light")).toContain(
      '<meta name="color-scheme" content="light">',
    );
    expect(await buildSrcdoc(compose({}), "dark")).toContain(
      '<meta name="color-scheme" content="dark">',
    );
  });

  it("probes every policy check, and eval only when eval is not approved", () => {
    expect(canaryProbes(compose({}))).toEqual(["connect", "img", "inline", "eval"]);
    expect(canaryProbes(compose({ "script-src": ["'unsafe-eval'"] }))).not.toContain(
      "eval",
    );
  });
});

describe("messages from a frame", () => {
  it("accepts the protocol's messages", () => {
    expect(GuestMessageSchema.safeParse({ t: "pong", seq: 1 }).success).toBe(true);
    expect(
      GuestMessageSchema.safeParse({ t: "write", traits: { filter: "x" } }).success,
    ).toBe(true);
  });

  it("refuses anything else", () => {
    for (const message of [
      { t: "eval", code: "1" },
      { t: "invoke", id: -1, name: "x", msg: {} },
      { t: "log", level: "fatal", text: "x" },
      { t: "error", phase: "boot", message: "x" },
      null,
      "hello",
    ])
      expect(GuestMessageSchema.safeParse(message).success).toBe(false);
  });
});
