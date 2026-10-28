import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { QueryRequest, SkillCatalogEntry } from "../protocol/types.ts";

export type CatalogSkill = Pick<SkillCatalogEntry, "slug" | "description">;

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

export function skillsCatalog(request: QueryRequest): CatalogSkill[] {
  const workspaceSkills = request.skills_catalog ?? [];
  const workspaceSlugs = new Set(workspaceSkills.map((skill) => skill.slug));
  return [...workspaceSkills, ...INES_SKILLS.filter((skill) => !workspaceSlugs.has(skill.slug))];
}

export function isInesSkill(request: QueryRequest, slug: string): boolean {
  return (
    INES_SKILLS.some((skill) => skill.slug === slug) &&
    !(request.skills_catalog ?? []).some((skill) => skill.slug === slug)
  );
}

export function inesSkills(): CatalogSkill[] {
  return INES_SKILLS.map(({ slug, description }) => ({ slug, description }));
}

const CONTENT = new Map(INES_SKILLS.map(({ slug }) => [slug, readFileSync(join(import.meta.dirname, `${slug}.md`), "utf8")]));

export function inesSkillContent(slug: string): string {
  const content = CONTENT.get(slug);
  if (content === undefined) throw new Error(`Ines has no skill named ${slug}.`);
  return content;
}
