import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "expect";
import { requireScope, scopeProblem, scopeSecretProblem } from "../../../../mcp-server/src/lib/scope-check.ts";
import { signScope } from "../../../../src/lib/scope.ts";

const SECRET = "0123456789abcdef0123";
const saved = process.env.INES_SCOPE_SECRET;

beforeEach(() => {
  process.env.INES_SCOPE_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.INES_SCOPE_SECRET;
  else process.env.INES_SCOPE_SECRET = saved;
});

const signed = (key: string) => ({ "x-ines-conversation-id": key, "x-ines-scope-sig": signScope(SECRET, key) });

describe("scopeProblem", () => {
  it("accepts the scope the agent signed", () => {
    expect(scopeProblem(signed("alice:chat-1"))).toBeNull();
  });

  it("refuses a call without a signature, or without a chat", () => {
    expect(scopeProblem({ "x-ines-conversation-id": "alice:chat-1" })).toContain("no signed chat scope");
    expect(scopeProblem({ "x-ines-scope-sig": "abc" })).toContain("no signed chat scope");
    expect(scopeProblem({})).toContain("no signed chat scope");
  });

  it("refuses another user's chat under the signature of one's own", () => {
    const own = signed("alice:chat-1");
    expect(scopeProblem({ ...own, "x-ines-conversation-id": "bob:chat-1" })).toContain("not signed by the agent");
  });

  it("refuses a signature made with another secret", () => {
    const forged = { "x-ines-conversation-id": "alice:chat-1", "x-ines-scope-sig": signScope("another-secret-another", "alice:chat-1") };
    expect(scopeProblem(forged)).toContain("not signed by the agent");
  });

  // The deployment that has no users has nobody to keep apart.
  it("lets every call go on when there is no secret because there are no users", () => {
    const noUsers = { INES_AUTH: "none" };
    expect(scopeProblem({}, "", noUsers)).toBeNull();
    expect(scopeProblem({ "x-ines-conversation-id": "anything" }, "", noUsers)).toBeNull();
  });

  // The fail-open this used to have: with users and no secret, any key a caller sent was taken as given,
  // which is one user reaching another user's documents and sandbox.
  it("refuses every call when there are users and no secret, rather than believing the caller", () => {
    for (const env of [{}, { INES_AUTH: "workspace" }]) {
      expect(scopeProblem({}, "", env)).toContain("no chat-scope secret");
      expect(scopeProblem({ "x-ines-conversation-id": "alice:chat-1" }, "", env)).toContain(
        "no chat-scope secret",
      );
      // Not even a signature made with some secret of the caller's own.
      expect(
        scopeProblem(
          { "x-ines-conversation-id": "alice:chat-1", "x-ines-scope-sig": signScope("their-own-secret", "alice:chat-1") },
          "",
          env,
        ),
      ).toContain("no chat-scope secret");
    }
  });
});

describe("scopeSecretProblem", () => {
  it("is content with a secret that is long enough", () => {
    expect(scopeSecretProblem({ INES_SCOPE_SECRET: SECRET })).toBeNull();
    expect(scopeSecretProblem({ INES_AUTH: "workspace", INES_SCOPE_SECRET: SECRET })).toBeNull();
  });

  it("refuses to start without a secret, which is the default mode", () => {
    expect(scopeSecretProblem({})).toContain("INES_SCOPE_SECRET is not set");
    expect(scopeSecretProblem({ INES_SCOPE_SECRET: "   " })).toContain("INES_SCOPE_SECRET is not set");
    expect(scopeSecretProblem({ INES_AUTH: "workspace" })).toContain("INES_SCOPE_SECRET is not set");
  });

  it("refuses a secret too short to be worth signing with", () => {
    expect(scopeSecretProblem({ INES_SCOPE_SECRET: "short" })).toContain("at least 16 characters");
  });

  // The named opt-out, and the only one: a deployment with no users has no user to keep apart.
  it("asks for nothing when the deployment has no users", () => {
    expect(scopeSecretProblem({ INES_AUTH: "none" })).toBeNull();
  });
});

describe("requireScope", () => {
  const handler = async (args: { "x-ines-conversation-id"?: string; "x-ines-scope-sig"?: string; value: number }) => ({
    content: [{ type: "text" as const, text: `ran with ${args.value}` }],
  });

  it("runs the tool for a signed scope", async () => {
    const result = await requireScope(handler)({ ...signed("alice:chat-1"), value: 7 });
    expect(result.content[0].text).toBe("ran with 7");
  });

  it("answers an error and does not run the tool for an unsigned or forged scope", async () => {
    let ran = false;
    const guarded = requireScope(async (args: { "x-ines-conversation-id"?: string; "x-ines-scope-sig"?: string; value: number }) => {
      ran = true;
      return { content: [{ type: "text" as const, text: String(args.value) }] };
    });
    for (const args of [
      { value: 1 },
      { "x-ines-conversation-id": "bob:chat-1", "x-ines-scope-sig": "forged", value: 1 },
    ]) {
      const result = await guarded(args);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.$ines_kind).toBe("error");
      expect(parsed.error.code).toBe("SCOPE_REJECTED");
    }
    expect(ran).toBe(false);
  });
});
