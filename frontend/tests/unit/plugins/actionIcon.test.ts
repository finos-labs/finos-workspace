import { describe, expect, it } from "vitest";
import SVG_RULES from "~/plugins/action-icon-svg.json";
import { sanitizeActionIcon } from "~/plugins/actionIcon";

const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe("an SVG icon that a plugin contributes", () => {
  it("keeps the shapes, local gradients and currentColor of a clean icon", () => {
    const svg = sanitizeActionIcon(
      `<svg ${NS} viewBox="0 0 16 16"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><path d="M0 0h16v16z" fill="currentColor"/><rect width="4" height="4" fill="url(#g)"/></svg>`,
    );
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('fill="url(#g)"');
    expect(svg).toContain('aria-hidden="true"');
  });

  it.each([
    [
      "a script",
      `<svg ${NS}><script>alert(1)</script><path d="M0 0"/></svg>`,
      "script",
    ],
    [
      "an event handler",
      `<svg ${NS} onload="alert(1)"><path d="M0 0"/></svg>`,
      "onload",
    ],
    [
      "a foreign object",
      `<svg ${NS}><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>`,
      "onerror",
    ],
    [
      "a link",
      `<svg ${NS}><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>`,
      "javascript",
    ],
    [
      "an outside reference",
      `<svg ${NS}><use href="https://evil.example/a.svg#i"/></svg>`,
      "evil",
    ],
    [
      "an outside paint",
      `<svg ${NS}><rect fill="url(https://evil.example/p)"/></svg>`,
      "evil",
    ],
    [
      "a style",
      `<svg ${NS}><style>*{background:url(https://evil.example/x)}</style></svg>`,
      "evil",
    ],
    [
      "a style attribute",
      `<svg ${NS}><rect style="fill:url(https://evil.example/x)"/></svg>`,
      "evil",
    ],
  ])("removes %s", (_name, input, forbidden) => {
    const svg = sanitizeActionIcon(input);
    expect(svg?.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain(forbidden);
  });

  it.each([
    ["a DOCTYPE", `<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg ${NS}>&a;</svg>`],
    ["markup that is not an svg", `<div><svg ${NS}/></div>`],
    ["two roots", `<svg ${NS}/><svg ${NS}/>`],
    [
      "a file past the limit",
      `<svg ${NS}><desc>${"x".repeat(SVG_RULES.maxBytes)}</desc></svg>`,
    ],
  ])("refuses %s", (_name, input) => {
    expect(sanitizeActionIcon(input)).toBeNull();
  });
});
