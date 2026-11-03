import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_USER_IMPORT_BYTES } from "~/components/AdminUsers/InviteUser/ImportUsers";
import { MCP_AUTH_TIMEOUT_MS } from "~/components/AI/hooks/mcp/useMcp";
import { MAX_RECORDING_MS } from "~/components/AI/hooks/useDictation";
import { GATEWAY_ERROR_BODY_CHARS } from "~/components/AI/hooks/useFunctionCall";
import {
  MAX_APP_PROMPT_LENGTH,
  MAX_APP_PROMPTS,
} from "~/components/General/AppDialog/schema";
import { REQUEST_TIMEOUT_MS } from "~/components/Widgets/Helpers/useIframeProtocol";
import {
  COPILOT_ACCEPTED_EXTENSIONS,
  ExtensionOptions,
  MAX_FILE_SIZE,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_SLUG_LENGTH,
  MIN_SKILL_SLUG_LENGTH,
  MULTIPLE_FILES_CONFIRMATION_COUNT,
  UPLOAD_BATCH_BYTES,
} from "~/lib/constants";
import { RENEW_WHEN_LEFT_MS } from "~/lib/state/agentToken";
import { templateSpecificationSchema } from "~/lib/types/app";
import {
  FORBIDDEN_HEADER_NAMES,
  FORBIDDEN_HEADER_PREFIXES,
  HEADER_NAME_PATTERN,
  HEADER_VALUE_PATTERN,
  RESERVED_HEADER_NAMES,
} from "~/lib/types/widgetsContract";
import { MAX_FOLDER_NAME_LENGTH, RESERVED_FOLDER_NAMES } from "~/utils/validators";

const OUT = process.env.REFERENCE_OUT ?? "";

function lengthLimit(pattern: string, shape: RegExp): number {
  const found = shape.exec(pattern);
  if (found === null) throw new Error(`${pattern} does not end in a length limit`);
  return Number(found[1]);
}

const values = (): Record<string, number | string | string[]> => ({
  fileExtensions: [...ExtensionOptions],
  copilotAttachmentExtensions: [...COPILOT_ACCEPTED_EXTENSIONS],
  fileExtensionsLabel: ExtensionOptions.map((extension) =>
    extension.toUpperCase(),
  ).join(", "),
  maxFileBytes: MAX_FILE_SIZE,
  multipleFilesConfirmationCount: MULTIPLE_FILES_CONFIRMATION_COUNT,
  uploadBatchBytes: UPLOAD_BATCH_BYTES,
  folderNameMaxLength: MAX_FOLDER_NAME_LENGTH,
  maxAppPrompts: MAX_APP_PROMPTS,
  maxDictationMilliseconds: MAX_RECORDING_MS,
  mcpAuthTimeoutMs: MCP_AUTH_TIMEOUT_MS,
  minSkillSlugLength: MIN_SKILL_SLUG_LENGTH,
  maxSkillSlugLength: MAX_SKILL_SLUG_LENGTH,
  maxSkillDescriptionLength: MAX_SKILL_DESCRIPTION_LENGTH,
  maxAppPromptLength: MAX_APP_PROMPT_LENGTH,
  reservedFolderNames: [...RESERVED_FOLDER_NAMES],
  userImportMaxBytes: MAX_USER_IMPORT_BYTES,
  agentTokenRenewSeconds: RENEW_WHEN_LEFT_MS / 1000,
  iframeRequestTimeoutMs: REQUEST_TIMEOUT_MS,
  gatewayErrorBodyChars: GATEWAY_ERROR_BODY_CHARS,
  forbiddenHeaderNames: [...FORBIDDEN_HEADER_NAMES],
  forbiddenHeaderPrefixes: [...FORBIDDEN_HEADER_PREFIXES],
  reservedHeaderNames: [...RESERVED_HEADER_NAMES],
  headerNameMaxLength: lengthLimit(HEADER_NAME_PATTERN, /\{1,(\d+)\}\$$/),
  headerValueMaxLength: lengthLimit(HEADER_VALUE_PATTERN, /\{0,(\d+)\}\$$/),
});

const appsSchema = () =>
  z.toJSONSchema(templateSpecificationSchema, { reused: "inline", target: "draft-7" });

function undescribed(node: unknown, path: string): string[] {
  if (node === null || typeof node !== "object") return [];
  const found: string[] = [];
  const schema = node as Record<string, unknown>;
  const properties = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  for (const [name, child] of Object.entries(properties ?? {})) {
    if (typeof child.description !== "string" || child.description.trim() === "") {
      found.push(`${path}.${name}`);
    }
    found.push(...undescribed(child, `${path}.${name}`));
  }
  for (const key of ["items", "additionalProperties"]) {
    found.push(...undescribed(schema[key], `${path}.${key}`));
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      branches.forEach((branch, index) => {
        found.push(...undescribed(branch, `${path}.${key}[${index}]`));
      });
    }
  }
  return found;
}

describe("the web app reference data", () => {
  it.runIf(OUT !== "")("is written for the documentation", () => {
    mkdirSync(resolve(OUT), { recursive: true });
    writeFileSync(
      resolve(OUT, "web-app-reference.json"),
      `${JSON.stringify({ values: values() }, null, 2)}\n`,
    );
    writeFileSync(
      resolve(OUT, "apps-schema.json"),
      `${JSON.stringify(appsSchema(), null, 2)}\n`,
    );
  });

  it("holds numbers, text and lists of text only", () => {
    for (const [key, value] of Object.entries(values())) {
      const plain =
        typeof value === "number" ||
        typeof value === "string" ||
        (Array.isArray(value) && value.every((item) => typeof item === "string"));
      expect(plain, key).toBe(true);
    }
  });

  it("describes every field of an apps.json entry", () => {
    expect(undescribed(appsSchema(), "apps.json")).toEqual([]);
  });
});
