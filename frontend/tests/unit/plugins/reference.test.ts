import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  COMMAND_PERMISSIONS,
  DEFAULT_SOURCES,
  ExportOptionSchema,
  TRAIT_DESCRIPTIONS,
  traitBindings,
} from "~/plugins/authority";
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

const OUT = process.env.REFERENCE_OUT ?? "";

function traitTable() {
  const holds = (name: string, permissions: string[], writable = false) =>
    traitBindings({} as never, new Set(permissions)).some(
      (binding) => binding.trait === name && (!writable || binding.writable),
    );
  return DEFAULT_SOURCES.map((name) => ({
    name,
    description: TRAIT_DESCRIPTIONS[name],
    requires: holds(name, [])
      ? null
      : (PERMISSIONS.find((permission) => holds(name, [permission])) ?? null),
    writableWith:
      PERMISSIONS.find((permission) => holds(name, [permission], true)) ?? null,
  }));
}

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
    traitTable: traitTable(),
    commandErrors: [...COMMAND_ERRORS],
    exportMembers: [...EXPORT_MEMBERS],
    commandPermissions: COMMAND_PERMISSIONS,
    permissions: [...PERMISSIONS],
    patterns: { pluginId: PLUGIN_ID_PATTERN.source },
    csp: {
      directives: [...POLICY_DIRECTIVES],
      floor: FLOOR,
      maxSources: MAX_SOURCES,
      maxSourceLength: MAX_SOURCE_LENGTH,
      confirmations: [...CONFIRMATIONS],
      privateSuffixes: PRIVATE_SUFFIXES,
    },
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
  it.runIf(OUT !== "")("is written for the documentation", () => {
    mkdirSync(resolve(OUT), { recursive: true });
    writeFileSync(resolve(OUT, "plugin-reference.json"), render());
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
