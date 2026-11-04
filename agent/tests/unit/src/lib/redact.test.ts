import { describe, it } from "node:test";
import { expect } from "expect";
import { redactRecord, redactString, redactValue } from "../../../../src/lib/redact.ts";

describe("redactString", () => {
  it("hides bearer tokens, JWTs and provider keys", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlc2lnbmF0dXJl";
    expect(redactString(`Authorization: Bearer ${jwt}`)).toBe("Authorization: Bearer [redacted]");
    expect(redactString(`token is ${jwt}`)).toBe("token is [jwt]");
    expect(redactString("key nvapi-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 here")).toBe("key [key] here");
    expect(redactString("sk-abcdefghijklmnopqrstuvwxyz")).toBe("[key]");
  });

  it("keeps the path of a presigned URL and hides its signature", () => {
    const url = "http://api:8000/app/files/presigned/abc.pdf?Expires=1791592531&Signature=f913a1f727c0be54d1b5";
    expect(redactString(`fetching ${url}`)).toBe(
      "fetching http://api:8000/app/files/presigned/abc.pdf?Expires=1791592531&Signature=[redacted]",
    );
    expect(redactString("https://s3.example/x?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA/20260101")).toBe(
      "https://s3.example/x?X-Amz-Signature=[redacted]&X-Amz-Credential=[redacted]",
    );
  });

  it("hides email addresses", () => {
    expect(redactString("user jane.doe+x@example.com signed in")).toBe("user [email] signed in");
  });

  it("replaces file bytes with their size", () => {
    expect(redactString("A".repeat(5000))).toBe("[base64 5000 chars]");
    expect(redactString(`see data:application/pdf;base64,${"QUJD".repeat(100)} end`)).toMatch(
      /^see data:\[base64 \d+ chars\] end$/,
    );
  });

  it("cuts a very long text and says how much was cut", () => {
    const text = "word ".repeat(1000);
    const out = redactString(text);
    expect(out.length).toBeLessThan(2100);
    expect(out).toContain("more chars]");
  });

  it("reads a text made to be slow for its patterns in bounded time, and still cuts it and says so", () => {
    for (const unit of ["a.", "a.b-", "a@", "sk-", "eyJabcde.", "data:a;base64,", "Bearer ", "?key="]) {
      const text = unit.repeat(Math.ceil(1_000_000 / unit.length));
      const start = performance.now();
      const out = redactString(text);
      expect(performance.now() - start).toBeLessThan(500);
      expect(out).toMatch(/more chars\]|^\[base64 \d+ chars\]$/);
      expect(out.length).toBeLessThan(2100);
    }
  });

  it("counts everything that was left out when it cuts", () => {
    const out = redactString(`${"word ".repeat(2000)}${"x".repeat(100_000)}`);
    const left = Number(/…\[(\d+) more chars\]$/.exec(out)?.[1]);
    expect(left).toBeGreaterThan(100_000 + 10_000 - 2_000 - 10);
    expect(left).toBeLessThanOrEqual(110_000);
  });

  it("leaves an ordinary message alone", () => {
    expect(redactString("Query received conversation=abc model=x widgets=3")).toBe(
      "Query received conversation=abc model=x widgets=3",
    );
  });
});

describe("redactValue", () => {
  it("omits what a provider error carries of the request, and keeps what helps to diagnose it", () => {
    const error = Object.assign(new Error("Bad Request"), {
      name: "AI_APICallError",
      statusCode: 400,
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      responseBody: '{"message":"data did not match any variant","code":400}',
      requestBodyValues: { model: "m", messages: [{ role: "user", content: "my private question" }] },
      responseHeaders: { "set-cookie": "session=abc", "content-type": "application/json" },
    });
    const out = redactValue(error) as Record<string, unknown>;
    expect(out.name).toBe("AI_APICallError");
    expect(out.message).toBe("Bad Request");
    expect(out.statusCode).toBe(400);
    expect(out.url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(out.responseBody).toContain("did not match any variant");
    expect(out.requestBodyValues).toBe("[omitted]");
    expect((out.responseHeaders as Record<string, string>)["set-cookie"]).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toContain("my private question");
  });

  it("redacts a secret by the name of its field, but not a count that happens to have a similar name", () => {
    const out = redactValue({
      access_token: "abc123",
      Authorization: "Bearer xyz",
      headers: { "x-api-key": "k", accept: "text/html" },
      inputTokens: 1200,
      totalTokens: 1500,
      prompt_cache_key: "conversation-1",
    }) as Record<string, unknown>;
    expect(out.access_token).toBe("[redacted]");
    expect(out.Authorization).toBe("[redacted]");
    expect(out.headers).toEqual({ "x-api-key": "[redacted]", accept: "text/html" });
    expect(out.inputTokens).toBe(1200);
    expect(out.totalTokens).toBe(1500);
    expect(out.prompt_cache_key).toBe("conversation-1");
  });

  it("redacts nested errors (a cause) and handles cycles and depth", () => {
    const inner = new Error("inner at https://x.test/f?token=SECRET");
    const outer = Object.assign(new Error("outer"), { cause: inner });
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const out = redactValue({ outer, cyclic, deep: { a: { b: { c: { d: { e: { f: 1 } } } } } } }) as Record<string, any>;
    expect(out.outer.cause.message).toBe("inner at https://x.test/f?token=[redacted]");
    expect(out.cyclic.self).toBe("[circular]");
    expect(JSON.stringify(out.deep)).toContain("[truncated]");
  });

  it("caps long arrays", () => {
    const out = redactValue(Array.from({ length: 50 }, (_, i) => i)) as unknown[];
    expect(out).toHaveLength(21);
    expect(out.at(-1)).toBe("[30 more items]");
  });

  it("passes numbers, booleans and null through", () => {
    expect(redactValue({ a: 1, b: true, c: null, d: undefined })).toEqual({ a: 1, b: true, c: null, d: undefined });
  });
});

describe("redactRecord", () => {
  it("redacts the message parts and the properties and keeps the rest of the record", () => {
    const record = {
      category: ["app"],
      level: "error" as const,
      timestamp: 1,
      rawMessage: "Failed for {who}",
      message: ["Failed for ", "jane@example.com", ""],
      properties: { requestBodyValues: { messages: ["secret"] }, count: 2 },
    };
    const out = redactRecord(record);
    expect(out.message[1]).toBe("[email]");
    expect(out.properties as Record<string, unknown>).toEqual({ requestBodyValues: "[omitted]", count: 2 });
    expect(out.category).toEqual(["app"]);
    expect(out.rawMessage).toBe("Failed for {who}");
    expect(record.properties.requestBodyValues).toEqual({ messages: ["secret"] });
  });
});
