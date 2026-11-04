import { describe, expect, it } from "vitest";
import {
  checkNetwork,
  checkPolicy,
  compose,
  directiveRisk,
  hosts,
  serialize,
} from "~/plugins/csp";
import cases from "~/plugins/csp-cases.json";

describe("plugin CSP rules", () => {
  describe.each(cases.author)("an author declares: $name", (testCase) => {
    it(testCase.ok ? "is accepted" : "is refused", () => {
      const check = checkPolicy(testCase.policy);
      expect(check.errors.length === 0, check.errors.join("; ")).toBe(testCase.ok);
      if ("needs" in testCase && testCase.needs)
        expect([...check.needs].sort()).toEqual([...testCase.needs].sort());
    });
  });

  describe.each(cases.override)("a superuser overrides: $name", (testCase) => {
    it(testCase.ok ? "is accepted" : "is refused", () => {
      const check = checkPolicy(testCase.policy, {
        confirmations: testCase.confirmations,
        override: true,
      });
      expect(check.errors.length === 0, check.errors.join("; ")).toBe(testCase.ok);
    });
  });

  describe.each(cases.network)("a server network: $name", (testCase) => {
    it(testCase.ok ? "is accepted" : "is refused", () => {
      const check = checkNetwork(testCase.network, {
        confirmations: "confirmations" in testCase ? testCase.confirmations : [],
        override: "override" in testCase ? testCase.override : false,
        backend: "backend" in testCase ? testCase.backend : false,
      });
      expect(check.errors.length === 0, check.errors.join("; ")).toBe(testCase.ok);
    });
  });

  describe.each(cases.compose)("composing: $name", (testCase) => {
    it("gives the effective policy", () => {
      expect(compose(testCase.policy)).toEqual(testCase.effective);
    });
  });

  it("puts the shell's hash first in script-src", () => {
    const policy = serialize(compose({}), "sha256-abc=");
    expect(policy).toContain("script-src 'sha256-abc=' blob:");
    expect(policy.startsWith("default-src 'none'")).toBe(true);
  });

  it("refuses to serialize anything that could break out of the policy", () => {
    expect(() =>
      serialize({ "img-src": ["https://a.example.com; script-src *"] }, "sha256-x"),
    ).toThrow();
    expect(() =>
      serialize({ "img-src": ['https://a.example.com"><script>'] }, "sha256-x"),
    ).toThrow();
    expect(() => serialize({ "img src": ["data:"] }, "sha256-x")).toThrow();
  });

  it("rates risk and lists egress hosts", () => {
    expect(directiveRisk("connect-src", ["https://api.example.com"])).toBe("high");
    expect(directiveRisk("img-src", ["data:"])).toBe("none");
    expect(directiveRisk("script-src", ["'wasm-unsafe-eval'"])).toBe("low");
    expect(directiveRisk("connect-src", ["http://api.example.com"])).toBe("critical");
    expect(
      hosts({ "connect-src": ["https://a.example.com"], "img-src": ["data:"] }),
    ).toEqual(["a.example.com"]);
  });
});
