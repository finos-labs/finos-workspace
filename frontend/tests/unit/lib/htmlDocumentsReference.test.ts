import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_BASE_STYLE,
  artifactContentSecurityPolicy,
} from "~/components/AI/artifactPolicy";
import {
  ARTIFACT_SANDBOX_ATTRIBUTES,
  ARTIFACT_SANDBOX_ATTRIBUTES_NO_SCRIPTS,
  IFRAME_SANDBOX_ATTRIBUTES,
  IFRAME_SRCDOC_SANDBOX_ATTRIBUTES,
} from "~/lib/constants";
import { HTML_SANITIZE_CONFIG } from "~/lib/utils/sanitize";

const OUT = process.env.REFERENCE_OUT ?? "";

const NONCE = "<nonce>";

function surfaces() {
  return [
    {
      name: "HTML widgets",
      draws: "The widget draws the response of its endpoint.",
      frame: "An `iframe` with `srcdoc`",
      sandbox: "",
      sandboxWithScripts: IFRAME_SRCDOC_SANDBOX_ATTRIBUTES,
      policy: null,
      policyWithScripts: null,
      sanitizing: null,
      added: ["A script that passes parameters on, when scripts are allowed"],
      theme: "The `theme` query parameter, `dark` or `light`, on the request",
    },
    {
      name: "iframe widgets",
      draws: "The widget draws the page at its URL.",
      frame: "An `iframe` with `src`",
      sandbox: IFRAME_SANDBOX_ATTRIBUTES,
      sandboxWithScripts: null,
      policy: null,
      policyWithScripts: null,
      sanitizing: null,
      added: [],
      theme: "The `theme` query parameter on the URL",
    },
    {
      name: "Agent HTML artifacts",
      draws: "The artifact draws the HTML that the model wrote.",
      frame: "An `iframe` with `srcdoc`",
      sandbox: ARTIFACT_SANDBOX_ATTRIBUTES_NO_SCRIPTS,
      sandboxWithScripts: ARTIFACT_SANDBOX_ATTRIBUTES,
      policy: artifactContentSecurityPolicy(),
      policyWithScripts: artifactContentSecurityPolicy(NONCE),
      sanitizing: {
        tags: HTML_SANITIZE_CONFIG.FORBID_TAGS,
        attributes: HTML_SANITIZE_CONFIG.FORBID_ATTR,
        dataAttributes: HTML_SANITIZE_CONFIG.ALLOW_DATA_ATTR,
      },
      added: [
        `A style element: ${ARTIFACT_BASE_STYLE}`,
        "A script that reports the height, when scripts are allowed",
      ],
      theme: "None: the model decides",
    },
  ];
}

describe("the HTML documents reference", () => {
  it("writes the reference data", () => {
    const data = surfaces();
    expect(data[2]?.policy).toContain("default-src 'none'");
    if (OUT === "") return;
    mkdirSync(resolve(OUT), { recursive: true });
    writeFileSync(
      resolve(OUT, "html-documents-reference.json"),
      `${JSON.stringify({ surfaces: data }, null, 2)}\n`,
    );
  });
});
