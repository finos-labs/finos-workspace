import { describe, it } from "node:test";
import { expect } from "expect";
import {
  htmlArtifactDescription,
  runHtmlArtifact,
} from "../../../../../src/agent/tools/html-artifact.ts";
import type { CopilotArtifact, SSEEvent } from "../../../../../src/protocol/types.ts";

describe("runHtmlArtifact", () => {
  // This server has no diagram tool of its own, so the description names none: a description that
  // named one would have the model call a tool that is not there.
  it("sends diagrams to a diagram tool only when one is listed", () => {
    expect(htmlArtifactDescription).toContain("flowcharts");
    expect(htmlArtifactDescription).toContain("if one is listed");
    expect(htmlArtifactDescription).not.toContain("mermaid_diagram");
  });

  it("emits a single html artifact onto the queue", () => {
    const artifactQueue: SSEEvent[] = [];
    const out = runHtmlArtifact(
      {
        html: "<h1>hi</h1>",
        name: "greeting",
        description: "a small greeting",
      },
      { artifactQueue },
    );
    expect(out).toContain("greeting");
    expect(artifactQueue).toHaveLength(1);
    expect(artifactQueue[0].event).toBe("copilotMessageArtifact");
    const artifact = artifactQueue[0].data as unknown as CopilotArtifact;
    expect(artifact.type).toBe("html");
    expect((artifact as { content: string }).content).toBe("<h1>hi</h1>");
  });

  it("rejects payloads exceeding the 50 KB cap with no artifact emitted", () => {
    const huge = "<p>" + "a".repeat(60 * 1024) + "</p>";
    const artifactQueue: SSEEvent[] = [];
    const out = runHtmlArtifact(
      { html: huge, name: "big", description: "x" },
      { artifactQueue },
    );
    expect(out).toMatch(/HTML too large/);
    expect(artifactQueue).toHaveLength(0);
  });

  it("assigns a fresh uuid per call", () => {
    const artifactQueue: SSEEvent[] = [];
    runHtmlArtifact(
      { html: "<p>1</p>", name: "a", description: "first" },
      { artifactQueue },
    );
    runHtmlArtifact(
      { html: "<p>2</p>", name: "b", description: "second" },
      { artifactQueue },
    );
    const a = artifactQueue[0].data as unknown as { uuid: string };
    const b = artifactQueue[1].data as unknown as { uuid: string };
    expect(a.uuid).not.toBe(b.uuid);
  });
});
