import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_COMMAND_NAMES,
  BRIDGE_ERROR_CODES,
  BRIDGE_LIMITS,
} from "~/components/AI/workspaceBridgeProtocol";

const FIXTURE = resolve(__dirname, "../../../fixtures/workspace-bridge-reference.json");
const BACKEND = resolve(
  __dirname,
  "../../../../../backend-api/backend/tests/fixtures/workspace_bridge.json",
);

const AGENT_ONLY = ["execute_agent_tool"];

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
  it("is what the code says", () => {
    if (process.env.UPDATE_REFERENCE) writeFileSync(FIXTURE, render());
    expect(readFileSync(FIXTURE, "utf8")).toBe(render());
  });
});

describe("the tab and the API agree on the bridge", () => {
  const backend = JSON.parse(readFileSync(BACKEND, "utf8"));

  it("name the same errors", () => {
    expect([...BRIDGE_ERROR_CODES]).toEqual(backend.errorCodes);
  });

  it("run the commands that the API sends, and the ones that only the agent sends", () => {
    const sent = backend.commands.map((command: { name: string }) => command.name);
    expect([...BRIDGE_COMMAND_NAMES].sort()).toEqual([...sent, ...AGENT_ONLY].sort());
  });

  it("keep the heartbeat inside the time that the API keeps a presence", () => {
    const presence = backend.constants.presenceTtlSeconds * 1000;
    expect(BRIDGE_LIMITS.heartbeatIntervalMs).toBeLessThan(presence);
  });
});
