import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { QueryRequest, SkillCatalogEntry } from "../protocol/types.ts";

export type CatalogSkill = Pick<SkillCatalogEntry, "slug" | "description">;

/**
 * Ines's own skills. Each one's instructions are the markdown file in this folder named by its slug. The FINOS Workspace
 * lists them as the agent's (`skills` in /agents.json), and the model loads them like the user's.
 */
const INES_SKILLS: readonly CatalogSkill[] = [
  {
    slug: "html-report",
    description: "Generate an HTML report using FINOS Workspace's reporting capabilities.",
  },
  {
    slug: "html-table",
    description: "When creating or styling a table widget for FINOS Workspace, follow these rules.",
  },
  {
    slug: "html-chart",
    description: "When creating or styling a chart widget (line/area/scatter) for FINOS Workspace, follow these rules.",
  },
];

/**
 * The skills the model may load: the user's own, which the FINOS Workspace lists, and Ines's.
 * A user's skill with the slug of one of Ines's takes its place.
 */
export function skillsCatalog(request: QueryRequest): CatalogSkill[] {
  const workspaceSkills = request.skills_catalog ?? [];
  const workspaceSlugs = new Set(workspaceSkills.map((skill) => skill.slug));
  return [...workspaceSkills, ...INES_SKILLS.filter((skill) => !workspaceSlugs.has(skill.slug))];
}

/** Whether Ines supplies this skill for this request; the FINOS Workspace supplies every other one. */
export function isInesSkill(request: QueryRequest, slug: string): boolean {
  return (
    INES_SKILLS.some((skill) => skill.slug === slug) &&
    !(request.skills_catalog ?? []).some((skill) => skill.slug === slug)
  );
}

/** Ines's skills as /agents.json lists them: the slug and what each is for. */
export function inesSkills(): CatalogSkill[] {
  return INES_SKILLS.map(({ slug, description }) => ({ slug, description }));
}

/** The instructions of each of Ines's skills, read once: they are part of the agent, and small. */
const CONTENT = new Map(INES_SKILLS.map(({ slug }) => [slug, readFileSync(join(import.meta.dirname, `${slug}.md`), "utf8")]));

/** The instructions of one of Ines's skills. */
export function inesSkillContent(slug: string): string {
  const content = CONTENT.get(slug);
  if (content === undefined) throw new Error(`Ines has no skill named ${slug}.`);
  return content;
}
