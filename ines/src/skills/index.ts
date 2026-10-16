import { join } from "node:path";
import type { QueryRequest, SkillCatalogEntry } from "../protocol/types";

export type CatalogSkill = Pick<SkillCatalogEntry, "slug" | "description">;

/** Ines's own skills. Each one's instructions are the markdown file in this folder named by its slug. */
const INES_SKILLS: readonly CatalogSkill[] = [
  {
    slug: "html-report",
    description: "Generate an HTML report using Workspace's reporting capabilities.",
  },
  {
    slug: "html-table",
    description: "When creating or styling a table widget for Workspace, follow these rules.",
  },
  {
    slug: "html-chart",
    description: "When creating or styling a chart widget (line/area/scatter) for Workspace, follow these rules.",
  },
];

/**
 * The skills the model may load: the user's own, which the Workspace lists, and Ines's.
 * A user's skill with the slug of one of Ines's takes its place.
 */
export function skillsCatalog(request: QueryRequest): CatalogSkill[] {
  const workspaceSkills = request.skills_catalog ?? [];
  const workspaceSlugs = new Set(workspaceSkills.map((skill) => skill.slug));
  return [...workspaceSkills, ...INES_SKILLS.filter((skill) => !workspaceSlugs.has(skill.slug))];
}

/** Whether Ines supplies this skill for this request; the Workspace supplies every other one. */
export function isInesSkill(request: QueryRequest, slug: string): boolean {
  return (
    INES_SKILLS.some((skill) => skill.slug === slug) &&
    !(request.skills_catalog ?? []).some((skill) => skill.slug === slug)
  );
}

export function readInesSkill(slug: string): Promise<string> {
  return Bun.file(join(import.meta.dir, `${slug}.md`)).text();
}
