import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { COMMAND_PERMISSIONS, ExportOptionSchema } from "~/plugins/authority";
import {
  CONFIRMATIONS,
  FLOOR,
  MAX_SOURCE_LENGTH,
  MAX_SOURCES,
  POLICY_DIRECTIVES,
  PRIVATE_SUFFIXES,
} from "~/plugins/csp";
import { FRAME_SANDBOX } from "~/plugins/frame";
import * as limits from "~/plugins/limits";
import {
  AFM_VERSION,
  COMMAND_ERRORS,
  EXPORT_MEMBERS,
  GuestMessageSchema,
  HostMessageSchema,
  MAX_EXPORT_BYTES,
  MAX_GUEST_MESSAGE_BYTES,
  RUNTIME_VERSION,
  SHELL_PORT,
  SHELL_READY,
} from "~/plugins/protocol";
import shellSource from "~/plugins/shell/shell.js?raw";
import {
  MAX_CONFIG_BYTES,
  MAX_STATE_BYTES,
  PERMISSIONS,
  PLUGIN_ID_PATTERN,
} from "~/plugins/types";

const FIXTURE = resolve(__dirname, "../../fixtures/plugin-reference.json");
const BACKEND = resolve(
  __dirname,
  "../../../../backend-api/backend/tests/fixtures/widget_plugins.json",
);

function reference() {
  return {
    versions: { runtime: RUNTIME_VERSION, afm: AFM_VERSION },
    shell: { ready: SHELL_READY, port: SHELL_PORT, sandbox: FRAME_SANDBOX },
    guestMessages: z.toJSONSchema(GuestMessageSchema, {
      io: "input",
      unrepresentable: "any",
    }),
    hostMessages: z.toJSONSchema(HostMessageSchema, {
      io: "input",
      unrepresentable: "any",
    }),
    exportOption: z.toJSONSchema(ExportOptionSchema, {
      io: "input",
      unrepresentable: "any",
    }),
    commandErrors: [...COMMAND_ERRORS],
    exportMembers: [...EXPORT_MEMBERS],
    commandPermissions: COMMAND_PERMISSIONS,
    permissions: [...PERMISSIONS],
    limits: {
      ...limits,
      maxGuestMessageBytes: MAX_GUEST_MESSAGE_BYTES,
      maxExportBytes: MAX_EXPORT_BYTES,
      maxStateBytes: MAX_STATE_BYTES,
      maxConfigBytes: MAX_CONFIG_BYTES,
    },
  };
}

const render = () => `${JSON.stringify(reference(), null, 2)}\n`;

describe("the plugin reference data", () => {
  it("is what the code says", () => {
    if (process.env.UPDATE_REFERENCE) writeFileSync(FIXTURE, render());
    expect(readFileSync(FIXTURE, "utf8")).toBe(render());
  });

  it("describes each message between the frame and the host", () => {
    const data = reference();
    const undescribed = [data.guestMessages, data.hostMessages].flatMap((schema) =>
      ((schema as { oneOf?: { description?: string }[] }).oneOf ?? []).filter(
        (message) => !message.description?.trim(),
      ),
    );
    expect(undescribed).toEqual([]);
  });

  it("describes each field of an export option", () => {
    const properties = (
      reference().exportOption as {
        properties: Record<string, { description?: string }>;
      }
    ).properties;
    expect(
      Object.entries(properties)
        .filter(([, field]) => !field.description?.trim())
        .map(([name]) => name),
    ).toEqual([]);
  });
});

describe("the shell and the host agree on the rules of a command", () => {
  it("time out a command alike", () => {
    expect(shellSource).toContain(`opts.timeout || ${limits.COMMAND_TIMEOUT_MS}`);
  });
});

describe("the host and the backend agree on the rules of a plugin", () => {
  const backend = JSON.parse(readFileSync(BACKEND, "utf8"));

  it("grant the same permissions", () => {
    expect([...PERMISSIONS].sort()).toEqual(
      backend.permissions.map((permission: { name: string }) => permission.name),
    );
  });

  it("implement the same versions", () => {
    expect(RUNTIME_VERSION).toBe(backend.host.api);
    expect(AFM_VERSION).toBe(backend.host.afm);
  });

  it("name plugins alike", () => {
    expect(PLUGIN_ID_PATTERN.source).toBe(backend.patterns.pluginId);
  });

  it("check the policy of a frame alike", () => {
    expect([...POLICY_DIRECTIVES]).toEqual(backend.csp.directives);
    expect(FLOOR).toEqual(backend.csp.floor);
    expect(MAX_SOURCES).toBe(backend.csp.maxSources);
    expect(MAX_SOURCE_LENGTH).toBe(backend.csp.maxSourceLength);
    expect([...CONFIRMATIONS]).toEqual(backend.csp.confirmations);
    expect(PRIVATE_SUFFIXES).toEqual(backend.csp.privateSuffixes);
  });

  it("report blocked requests alike", () => {
    expect(limits.MAX_REPORTS_PER_FLUSH).toBe(backend.reports.perRequest);
  });
});
