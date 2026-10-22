import { afterEach, describe, expect, it } from "vitest";
import { isApiFileUrl, isApiUrl, isDefaultCopilotUrl } from "~/lib/utils/fetch";
import { mockConfig } from "../../../mocks/runtimeConfig";

// The test runtime config: API http://localhost:3000, default Copilot http://localhost:3000/ai
describe("isApiUrl", () => {
  it.each([
    "http://localhost:3000/app/session",
    "http://localhost:3000",
    "/app/session",
    new URL("http://localhost:3000/totp"),
  ])("accepts the API's origin: %s", (url) => {
    expect(isApiUrl(url)).toBe(true);
  });

  it.each([
    "http://localhost:3000.evil.test/app/session",
    "http://evil.test/http://localhost:3000/app/session",
    "http://evil.test/?u=http://localhost:3000",
    "https://localhost:3000/app/session",
    "http://localhost:3001/app/session",
    "http://user@evil.test/",
  ])("refuses any other origin: %s", (url) => {
    expect(isApiUrl(url)).toBe(false);
  });
});

describe("isApiFileUrl", () => {
  afterEach(() => {
    mockConfig.urls.backend = "http://localhost:3000";
  });

  it.each([
    "http://localhost:3000/app/files/report.pdf",
    "/app/files/report.pdf",
  ])("accepts the API's file routes: %s", (url) => {
    expect(isApiFileUrl(url)).toBe(true);
  });

  it.each([
    "http://localhost:3000/app/logout",
    "http://localhost:3000/app/dash/validate-and-sync",
    "http://localhost:3000/app/files/../logout",
    "http://localhost:3000/app/filesystem",
    "http://localhost:3000.evil.test/app/files/report.pdf",
    "https://files.example.test/app/files/report.pdf",
  ])("refuses every other URL: %s", (url) => {
    expect(isApiFileUrl(url)).toBe(false);
  });

  it("follows an API served under a path", () => {
    mockConfig.urls.backend = "http://localhost:3000/api";

    expect(isApiFileUrl("http://localhost:3000/api/app/files/report.pdf")).toBe(true);
    expect(isApiFileUrl("http://localhost:3000/app/files/report.pdf")).toBe(false);
  });
});

describe("isDefaultCopilotUrl", () => {
  afterEach(() => {
    mockConfig.urls.ai = "http://localhost:3000/ai";
  });

  it.each([
    "http://localhost:3000/ai",
    "http://localhost:3000/ai/v1/query",
    "http://localhost:3000/ai/v1/generate/widget_info",
  ])("accepts AI_API_URL and the paths below it: %s", (url) => {
    expect(isDefaultCopilotUrl(url)).toBe(true);
  });

  it.each([
    "http://localhost:3000/aiagent/v1/query",
    "http://localhost:3000/app/user",
    "http://localhost:3000.evil.test/ai/v1/query",
    "https://agent.example.test/ai/v1/query",
  ])("refuses other agents and paths: %s", (url) => {
    expect(isDefaultCopilotUrl(url)).toBe(false);
  });

  it("accepts every path of an AI_API_URL at an origin's root", () => {
    mockConfig.urls.ai = "https://ines.example.test/";

    expect(isDefaultCopilotUrl("https://ines.example.test/v1/query")).toBe(true);
    expect(isDefaultCopilotUrl("https://other.example.test/v1/query")).toBe(false);
  });

  it("matches nothing when no default Copilot is configured", () => {
    mockConfig.urls.ai = "";

    expect(isDefaultCopilotUrl("http://localhost:3000/ai/v1/query")).toBe(false);
  });
});
