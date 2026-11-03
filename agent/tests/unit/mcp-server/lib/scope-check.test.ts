import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "expect";
import { requireScope, scopeProblem, scopeSecretProblem } from "../../../../mcp-server/src/lib/scope-check.ts";
import { signScope } from "../../../../src/lib/scope.ts";

const SECRET = "0123456789abcdef0123";
const saved = process.env.AGENT_SCOPE_SECRET;

beforeEach(() => {
  process.env.AGENT_SCOPE_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.AGENT_SCOPE_SECRET;
  else process.env.AGENT_SCOPE_SECRET = saved;
});

const signed = (key: string) => ({ "x-agent-conversation-id": key, "x-agent-scope-sig": signScope(SECRET, key) });

describe("scopeProblem", () => {
  it("accepts the scope the agent signed", () => {
    expect(scopeProblem(signed("alice:chat-1"))).toBeNull();
  });

  it("refuses a call without a signature, or without a chat", () => {
    expect(scopeProblem({ "x-agent-conversation-id": "alice:chat-1" })).toContain("no signed chat scope");
    expect(scopeProblem({ "x-agent-scope-sig": "abc" })).toContain("no signed chat scope");
    expect(scopeProblem({})).toContain("no signed chat scope");
  });

  it("refuses another user's chat under the signature of one's own", () => {
    const own = signed("alice:chat-1");
    expect(scopeProblem({ ...own, "x-agent-conversation-id": "bob:chat-1" })).toContain("not signed by the agent");
  });

  it("refuses a signature made with another secret", () => {
    const forged = { "x-agent-conversation-id": "alice:chat-1", "x-agent-scope-sig": signScope("another-secret-another", "alice:chat-1") };
    expect(scopeProblem(forged)).toContain("not signed by the agent");
  });

  it("lets every call go on when there is no secret because there are no users", () => {
    const noUsers = { AGENT_AUTH: "none" };
    expect(scopeProblem({}, "", noUsers)).toBeNull();
    expect(scopeProblem({ "x-agent-conversation-id": "anything" }, "", noUsers)).toBeNull();
  });

  it("refuses every call when there are users and no secret, rather than believing the caller", () => {
    for (const env of [{}, { AGENT_AUTH: "workspace" }]) {
      expect(scopeProblem({}, "", env)).toContain("no chat-scope secret");
      expect(scopeProblem({ "x-agent-conversation-id": "alice:chat-1" }, "", env)).toContain(
        "no chat-scope secret",
      );
      expect(
        scopeProblem(
          { "x-agent-conversation-id": "alice:chat-1", "x-agent-scope-sig": signScope("their-own-secret", "alice:chat-1") },
          "",
          env,
        ),
      ).toContain("no chat-scope secret");
    }
  });
});

describe("scopeSecretProblem", () => {
  it("is content with a secret that is long enough", () => {
    expect(scopeSecretProblem({ AGENT_SCOPE_SECRET: SECRET })).toBeNull();
    expect(scopeSecretProblem({ AGENT_AUTH: "workspace", AGENT_SCOPE_SECRET: SECRET })).toBeNull();
  });

  it("refuses to start without a secret, which is the default mode", () => {
    expect(scopeSecretProblem({})).toContain("AGENT_SCOPE_SECRET is not set");
    expect(scopeSecretProblem({ AGENT_SCOPE_SECRET: "   " })).toContain("AGENT_SCOPE_SECRET is not set");
    expect(scopeSecretProblem({ AGENT_AUTH: "workspace" })).toContain("AGENT_SCOPE_SECRET is not set");
  });

  it("refuses a secret too short to be worth signing with", () => {
    expect(scopeSecretProblem({ AGENT_SCOPE_SECRET: "short" })).toContain("at least 16 characters");
  });

  it("asks for nothing when the deployment has no users", () => {
    expect(scopeSecretProblem({ AGENT_AUTH: "none" })).toBeNull();
  });
});

describe("requireScope", () => {
  const handler = async (args: { "x-agent-conversation-id"?: string; "x-agent-scope-sig"?: string; value: number }) => ({
    content: [{ type: "text" as const, text: `ran with ${args.value}` }],
  });

  it("runs the tool for a signed scope", async () => {
    const result = await requireScope(handler)({ ...signed("alice:chat-1"), value: 7 });
    expect(result.content[0].text).toBe("ran with 7");
  });

  it("answers an error and does not run the tool for an unsigned or forged scope", async () => {
    let ran = false;
    const guarded = requireScope(async (args: { "x-agent-conversation-id"?: string; "x-agent-scope-sig"?: string; value: number }) => {
      ran = true;
      return { content: [{ type: "text" as const, text: String(args.value) }] };
    });
    for (const args of [
      { value: 1 },
      { "x-agent-conversation-id": "bob:chat-1", "x-agent-scope-sig": "forged", value: 1 },
    ]) {
      const result = await guarded(args);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.$agent_kind).toBe("error");
      expect(parsed.error.code).toBe("SCOPE_REJECTED");
    }
    expect(ran).toBe(false);
  });
});
