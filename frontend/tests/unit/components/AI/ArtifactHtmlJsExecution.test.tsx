import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Artifact from "~/components/AI/Artifact";
import type { ArtifactT } from "~/lib/state/copilot";
import { mockConfig } from "../../../mocks/runtimeConfig";

const artifact = (uuid: string, name: string): ArtifactT => ({
  uuid,
  type: "html",
  content: "<html><body><h1>Report</h1></body></html>",
  name,
  description: "A JavaScript-enabled HTML artifact",
});

function postHeight(iframe: HTMLIFrameElement, height: number) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "artifactHeight", height },
      source: iframe.contentWindow,
    }),
  );
}

describe("Artifact HTML JavaScript execution", () => {
  beforeEach(() => {
    mockConfig.data.allowHtmlJsExecution = true;
  });

  afterEach(() => {
    mockConfig.data.allowHtmlJsExecution = false;
  });

  it("does not give an artifact this app's origin, even with scripts on", () => {
    const { container } = render(
      <Artifact artifact={artifact("html-js-origin", "Origin")} inAiMessage={true} />,
    );

    const sandbox = container.querySelector("iframe")?.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  it("shares the origin only when nothing can run in the artifact", () => {
    mockConfig.data.allowHtmlJsExecution = false;
    const { container } = render(
      <Artifact artifact={artifact("html-no-js", "No scripts")} inAiMessage={true} />,
    );

    const sandbox = container.querySelector("iframe")?.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
  });

  it("takes the height the artifact posts, capped at the maximum", async () => {
    const { container } = render(
      <Artifact
        artifact={artifact("html-js-123", "HTML JS Artifact")}
        inAiMessage={true}
      />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;

    postHeight(iframe, 2000);

    await waitFor(() => {
      expect(iframe).toHaveStyle({ height: "600px" });
    });
  }, 15000);

  it("ignores a height posted by anything but the artifact itself", async () => {
    const { container } = render(
      <Artifact artifact={artifact("html-js-other", "Elsewhere")} inAiMessage={true} />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "artifactHeight", height: 2000 },
        source: window,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(iframe).toHaveStyle({ minHeight: "50px" });
    expect(iframe).not.toHaveStyle({ height: "600px" });
  }, 15000);

  it("does not read the document to measure it while scripts are on", async () => {
    const { container } = render(
      <Artifact artifact={artifact("html-js-456", "Standalone")} inAiMessage={true} />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument;

    Object.defineProperty(doc?.documentElement, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(doc?.body, "scrollHeight", {
      configurable: true,
      value: 2000,
    });

    fireEvent.load(iframe);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(iframe).toHaveStyle({ minHeight: "50px" });
    expect(iframe).not.toHaveStyle({ height: "600px" });
  }, 15000);
});
