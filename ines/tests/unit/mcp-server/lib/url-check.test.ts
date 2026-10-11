import { describe, it, expect } from "bun:test";
import { urlProblem } from "../../../../mcp-server/src/lib/url-check";
import { signUrl } from "../../../../src/lib/scope";

const SECRET = "0123456789abcdef0123";
const URL_A = "https://example.com/report";

describe("urlProblem", () => {
  it("lets through an address the agent signed", () => {
    expect(urlProblem(URL_A, signUrl(SECRET, URL_A), SECRET, false)).toBeNull();
  });

  it("refuses an address without a signature", () => {
    expect(urlProblem(URL_A, undefined, SECRET, false)).toContain("was not given in this conversation");
    expect(urlProblem(URL_A, "", SECRET, false)).toContain("was not given");
  });

  it("refuses another address under the signature of one that was given", () => {
    const signature = signUrl(SECRET, URL_A);
    expect(urlProblem(`${URL_A}?d=secret`, signature, SECRET, false)).not.toBeNull();
    expect(urlProblem("https://attacker.example/", signature, SECRET, false)).not.toBeNull();
  });

  it("refuses a signature made with another secret, and one made for a chat scope", async () => {
    expect(urlProblem(URL_A, signUrl("another-secret-another", URL_A), SECRET, false)).not.toBeNull();
    const { signScope } = await import("../../../../src/lib/scope");
    expect(urlProblem(URL_A, signScope(SECRET, URL_A), SECRET, false)).not.toBeNull();
  });

  it("does not repeat the address, so that the refusal cannot make it a given one", () => {
    const attack = "https://attacker.example/collect?d=my-holdings";
    const problem = urlProblem(attack, undefined, SECRET, false)!;
    expect(problem).not.toContain("attacker");
    expect(problem).not.toContain("my-holdings");
  });

  // A deployment with no users has no user whose data an address could carry out.
  it("lets every address through where there are no users, and where every address is allowed by name", () => {
    expect(urlProblem(URL_A, undefined, undefined, false, { INES_AUTH: "none" })).toBeNull();
    expect(urlProblem(URL_A, undefined, SECRET, true)).toBeNull();
  });

  // The fail-open this used to have: with users and no secret, any address the model named was fetched,
  // which is the way out that signing addresses exists to close.
  it("fetches no address at all when there are users and no secret", () => {
    for (const env of [{}, { INES_AUTH: "workspace" }]) {
      const problem = urlProblem(URL_A, undefined, undefined, false, env);
      expect(problem).toContain("not configured");
      expect(problem).not.toContain(URL_A);
    }
  });
});
