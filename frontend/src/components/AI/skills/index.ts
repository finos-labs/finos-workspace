import { useThemeStore } from "~/lib/state/theme";
import type { DefaultSkillSlugs, Skill } from "~/types/auth.type";

export const defaultSkillSlugs = ["html-report", "html-table", "html-chart"] as const;

export function isDefaultSkill(slug: string): slug is DefaultSkillSlugs {
  return defaultSkillSlugs.includes(slug as DefaultSkillSlugs);
}

// Workspace no longer ships skills of its own. The slugs above remain because users'
// saved display settings (removedSkillSlugs) may still name them.
export const DEFAULT_SKILLS: Skill[] = [];

export function getActiveDefaultSkills(userSkills: Skill[] = []): Skill[] {
  const removedSkillSlugs = useThemeStore.getState().removedSkillSlugs || [];

  const removedSet = new Set<string>(removedSkillSlugs);
  const defaults = DEFAULT_SKILLS.filter((skill) => !removedSet.has(skill.id));
  return [...userSkills, ...defaults];
}
