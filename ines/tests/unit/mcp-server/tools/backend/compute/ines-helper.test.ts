import { describe, it, expect } from "bun:test";
import { INES_PY_SOURCE } from "../../../../../../mcp-server/src/tools/backend/compute/ines-helper";

describe("INES_PY_SOURCE", () => {
  it("defines the show() entry point", () => {
    expect(INES_PY_SOURCE).toMatch(/def\s+show\s*\(/);
  });

  it("emits JSON sentinels framed with the expected null-byte head/tail", () => {
    expect(INES_PY_SOURCE).toContain("\\x00__x_ines_artifact__\\x00");
    expect(INES_PY_SOURCE).toContain("_SENTINEL_TAIL");
  });

  it("supports plotly, matplotlib, and pandas type-checks", () => {
    expect(INES_PY_SOURCE).toContain("_is_plotly");
    expect(INES_PY_SOURCE).toContain("_is_matplotlib");
    expect(INES_PY_SOURCE).toContain("_is_dataframe");
  });

  it("base64-encodes the JSON payload", () => {
    expect(INES_PY_SOURCE).toContain("base64.b64encode(json.dumps(payload)");
  });
});
