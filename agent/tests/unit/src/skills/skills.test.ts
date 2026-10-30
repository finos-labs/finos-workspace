import { describe, it } from "node:test";
import { expect } from "expect";
import { agentSkillContent, agentSkills, isAgentSkill, skillsCatalog } from "../../../../src/skills/index.ts";
import type { QueryRequest } from "../../../../src/protocol/types.ts";

const request = (skills_catalog?: QueryRequest["skills_catalog"]): QueryRequest =>
  ({ messages: [{ role: "human", content: "hi" }], skills_catalog }) as QueryRequest;

const AGENT_SLUGS = ["html-report", "html-table", "html-chart"];

describe("skillsCatalog", () => {
  it("lists the agent's own skills when the FINOS Workspace lists none", () => {
    expect(skillsCatalog(request()).map((s) => s.slug)).toEqual(AGENT_SLUGS);
  });

  it("lists the user's skills first, then the agent's", () => {
    const catalog = skillsCatalog(request([{ slug: "earnings", description: "earnings flow", updatedAt: "" }]));
    expect(catalog.map((s) => s.slug)).toEqual(["earnings", ...AGENT_SLUGS]);
  });

  it("a user's skill with the slug of one of the agent's takes its place", () => {
    const catalog = skillsCatalog(request([{ slug: "html-chart", description: "my charts", updatedAt: "" }]));
    expect(catalog.filter((s) => s.slug === "html-chart").map((s) => s.description)).toEqual(["my charts"]);
  });
});

describe("isAgentSkill", () => {
  it("is true for the agent's own skills", () => {
    for (const slug of AGENT_SLUGS) expect(isAgentSkill(request(), slug)).toBe(true);
  });

  it("is false for the user's skills, including one with the slug of one of the agent's", () => {
    expect(isAgentSkill(request([{ slug: "earnings", description: "", updatedAt: "" }]), "earnings")).toBe(false);
    expect(isAgentSkill(request([{ slug: "html-chart", description: "", updatedAt: "" }]), "html-chart")).toBe(false);
  });
});

describe("agentSkills", () => {
  it("lists the agent's skills by slug and what each is for, without their instructions", () => {
    const skills = agentSkills();
    expect(skills.map((s) => s.slug)).toEqual(AGENT_SLUGS);
    for (const skill of skills) {
      expect(Object.keys(skill).sort()).toEqual(["description", "slug"]);
      expect(skill.description.length).toBeGreaterThan(0);
    }
  });
});

describe("agentSkillContent", () => {
  it("has the instructions of every skill the agent lists", () => {
    for (const slug of AGENT_SLUGS) expect(agentSkillContent(slug).trim().length).toBeGreaterThan(0);
    expect(agentSkillContent("html-chart")).toContain("# FINOS Workspace chart colors skill");
  });

  it("has none of a skill the agent does not have", () => {
    expect(() => agentSkillContent("earnings")).toThrow("The agent has no skill named earnings.");
  });
});
