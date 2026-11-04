import { describe, it } from "node:test";
import { expect } from "expect";
import type { LogRecord } from "@logtape/logtape";
import { parseLogFormat, parseLogLevel, redactingSink } from "../../../../src/lib/logging.ts";

describe("parseLogLevel", () => {
  it("defaults to info in production and debug otherwise", () => {
    expect(parseLogLevel({ NODE_ENV: "production" })).toBe("info");
    expect(parseLogLevel({})).toBe("debug");
  });

  it("takes LOG_LEVEL, in any case, with warn for warning", () => {
    expect(parseLogLevel({ LOG_LEVEL: "ERROR" })).toBe("error");
    expect(parseLogLevel({ LOG_LEVEL: "warn", NODE_ENV: "production" })).toBe("warning");
  });

  it("refuses a level it does not know instead of logging at some other one", () => {
    expect(() => parseLogLevel({ LOG_LEVEL: "verbose" })).toThrow("LOG_LEVEL must be one of");
  });
});

describe("parseLogFormat", () => {
  it("defaults to json in production and pretty otherwise", () => {
    expect(parseLogFormat({ NODE_ENV: "production" })).toBe("json");
    expect(parseLogFormat({})).toBe("pretty");
  });

  it("takes LOG_FORMAT and refuses other values", () => {
    expect(parseLogFormat({ LOG_FORMAT: "JSON" })).toBe("json");
    expect(() => parseLogFormat({ LOG_FORMAT: "xml" })).toThrow("LOG_FORMAT must be json or pretty");
  });
});

describe("redactingSink", () => {
  it("hands the next sink a redacted record", () => {
    const written: LogRecord[] = [];
    const sink = redactingSink((record) => written.push(record));
    sink({
      category: ["app", "x"],
      level: "error",
      timestamp: 1,
      rawMessage: "Fetching {url}",
      message: ["Fetching ", "http://api:8000/f.pdf?Signature=abc123", ""],
      properties: { error: Object.assign(new Error("boom"), { requestBodyValues: { messages: ["private"] } }) },
    });
    expect(written).toHaveLength(1);
    expect(written[0].message[1]).toBe("http://api:8000/f.pdf?Signature=[redacted]");
    expect(JSON.stringify(written[0].properties)).not.toContain("private");
    expect((written[0].properties.error as { message: string }).message).toBe("boom");
  });
});
