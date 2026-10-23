import { describe, it } from "node:test";
import { expect } from "expect";
import { inesSkillContent, inesSkills, isInesSkill, skillsCatalog } from "../../../../src/skills/index.ts";
import type { QueryRequest } from "../../../../src/protocol/types.ts";

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

describe("inesSkills", () => {
  it("lists Ines's skills by slug and what each is for, without their instructions", () => {
    const skills = inesSkills();
    expect(skills.map((s) => s.slug)).toEqual(INES_SLUGS);
    for (const skill of skills) {
      expect(Object.keys(skill).sort()).toEqual(["description", "slug"]);
      expect(skill.description.length).toBeGreaterThan(0);
    }
  });
});

describe("inesSkillContent", () => {
  it("has the instructions of every skill Ines lists", () => {
    for (const slug of INES_SLUGS) expect(inesSkillContent(slug).trim().length).toBeGreaterThan(0);
    expect(inesSkillContent("html-chart")).toContain("# Workspace chart colors skill");
  });

  it("has none of a skill Ines does not have", () => {
    expect(() => inesSkillContent("earnings")).toThrow("Ines has no skill named earnings.");
  });
});
