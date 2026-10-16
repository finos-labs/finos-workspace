import { describe, it, expect } from "bun:test";
import { isInesSkill, readInesSkill, skillsCatalog } from "../../../../src/skills";
import type { QueryRequest } from "../../../../src/protocol/types";

const request = (skills_catalog?: QueryRequest["skills_catalog"]): QueryRequest =>
  ({ messages: [{ role: "human", content: "hi" }], skills_catalog }) as QueryRequest;

const INES_SLUGS = ["html-report", "html-table", "html-chart"];

describe("skillsCatalog", () => {
  it("lists Ines's own skills when the Workspace lists none", () => {
    expect(skillsCatalog(request()).map((s) => s.slug)).toEqual(INES_SLUGS);
  });

  it("lists the user's skills first, then Ines's", () => {
    const catalog = skillsCatalog(request([{ slug: "earnings", description: "earnings flow", updatedAt: "" }]));
    expect(catalog.map((s) => s.slug)).toEqual(["earnings", ...INES_SLUGS]);
  });

  it("a user's skill with the slug of one of Ines's takes its place", () => {
    const catalog = skillsCatalog(request([{ slug: "html-chart", description: "my charts", updatedAt: "" }]));
    expect(catalog.filter((s) => s.slug === "html-chart").map((s) => s.description)).toEqual(["my charts"]);
  });
});

describe("isInesSkill", () => {
  it("is true for Ines's own skills", () => {
    for (const slug of INES_SLUGS) expect(isInesSkill(request(), slug)).toBe(true);
  });

  it("is false for the user's skills, including one with the slug of one of Ines's", () => {
    expect(isInesSkill(request([{ slug: "earnings", description: "", updatedAt: "" }]), "earnings")).toBe(false);
    expect(isInesSkill(request([{ slug: "html-chart", description: "", updatedAt: "" }]), "html-chart")).toBe(false);
  });
});

describe("readInesSkill", () => {
  it("reads the instructions of every skill in the catalog", async () => {
    for (const slug of INES_SLUGS) {
      expect((await readInesSkill(slug)).trim().length).toBeGreaterThan(0);
    }
    expect(await readInesSkill("html-chart")).toContain("# Workspace chart colors skill");
  });
});
