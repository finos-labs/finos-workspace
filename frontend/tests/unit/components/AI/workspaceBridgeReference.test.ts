import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_COMMAND_NAMES,
  BRIDGE_ERROR_CODES,
  BRIDGE_LIMITS,
} from "~/components/AI/workspaceBridgeProtocol";

const OUT = process.env.REFERENCE_OUT ?? "";

const render = () =>
  `${JSON.stringify(
    {
      limits: BRIDGE_LIMITS,
      commands: BRIDGE_COMMAND_NAMES,
      errorCodes: BRIDGE_ERROR_CODES,
    },
    null,
    2,
  )}\n`;

describe("the bridge reference data", () => {
  it.runIf(OUT !== "")("is written for the documentation", () => {
    mkdirSync(resolve(OUT), { recursive: true });
    writeFileSync(resolve(OUT, "workspace-bridge-reference.json"), render());
  });

  it("names each command and each error code once", () => {
    expect(new Set(BRIDGE_COMMAND_NAMES).size).toBe(BRIDGE_COMMAND_NAMES.length);
    expect(new Set(BRIDGE_ERROR_CODES).size).toBe(BRIDGE_ERROR_CODES.length);
  });
});
