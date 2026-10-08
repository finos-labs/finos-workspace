import { useThemeStore } from "~/lib/state/theme";
import type { DefaultSkillSlugs, Skill } from "~/types/auth.type";
import { markdown as HTML_CHART } from "./html-chart.md";
import { markdown as HTML_REPORT } from "./html-report.md";
import { markdown as HTML_TABLE } from "./html-table.md";

const createdDate = "2026-03-01T00:00:00.000Z";
const widgetStyleCreatedDate = "2026-08-21T00:00:00.000Z";

export const defaultSkillSlugs = ["html-report", "html-table", "html-chart"] as const;

export function isDefaultSkill(slug: string): slug is DefaultSkillSlugs {
  return defaultSkillSlugs.includes(slug as DefaultSkillSlugs);
}

export const DEFAULT_SKILLS = [
  {
    content: HTML_REPORT,
    description: "Generate an HTML report using Workspace's reporting capabilities.",
    slug: "html-report",
    id: "html-report",
    createdDate,
    // Can be updated to a more recent date if the content changes,
    // but for now it matches createdDate since it's new
    updatedDate: createdDate,
  },
  {
    content: HTML_TABLE,
    description:
      "When creating or styling a table widget for Workspace, follow these rules.",
    slug: "html-table",
    id: "html-table",
    createdDate: widgetStyleCreatedDate,
    updatedDate: widgetStyleCreatedDate,
  },
  {
    content: HTML_CHART,
    description:
      "When creating or styling a chart widget (line/area/scatter) for Workspace, follow these rules.",
    slug: "html-chart",
    id: "html-chart",
    createdDate: widgetStyleCreatedDate,
    updatedDate: widgetStyleCreatedDate,
  },
] as const satisfies Skill[];

export function getActiveDefaultSkills(userSkills: Skill[] = []): Skill[] {
  const removedSkillSlugs = useThemeStore.getState().removedSkillSlugs || [];

  const removedSet = new Set(removedSkillSlugs);
  const defaults = DEFAULT_SKILLS.filter((skill) => !removedSet.has(skill.id));
  return [...userSkills, ...defaults];
}
