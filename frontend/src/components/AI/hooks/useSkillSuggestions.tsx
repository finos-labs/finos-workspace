import Fuse from "fuse.js";
import { useCallback, useMemo } from "react";
import { useShallowCopilotStore } from "~/lib/state/copilot";
import { useShallowSkillsLibraryStore } from "~/lib/state/skillsLibrary";

export const SKILL_TRIGGER = "/skill:";

export interface SkillSuggestion {
  type: "skill";
  slug: string;
  description: string;
  content: string;
  slashText: string;
}

const toSlashText = (slug: string) =>
  `/skill:${slug}`.replace(/ /g, "\u00A0").replace(/-/g, "\u2011");

export function useSkillSuggestions() {
  const skills = useShallowSkillsLibraryStore((s) => s.skills);
  const agentSkills = useShallowCopilotStore((s) => s.selectedCopilot?.skills);

  const skillOptions = useMemo((): SkillSuggestion[] => {
    const own = skills.map((skill) => ({
      type: "skill" as const,
      slug: skill.slug,
      description: skill.description,
      content: skill.content,
      slashText: toSlashText(skill.slug),
    }));
    const ownSlugs = new Set(skills.map((skill) => skill.slug));
    const agents = (agentSkills ?? [])
      .filter((skill) => !ownSlugs.has(skill.slug))
      .map((skill) => ({
        type: "skill" as const,
        slug: skill.slug,
        description: skill.description,
        content: "",
        slashText: toSlashText(skill.slug),
      }));
    return [...own, ...agents];
  }, [skills, agentSkills]);

  const fuse = useMemo(
    () =>
      new Fuse(skillOptions, {
        keys: ["slug", "description"],
        threshold: 0.3,
      }),
    [skillOptions],
  );

  const searchSkills = useCallback(
    (query: string): SkillSuggestion[] => {
      const searchTerm = query.startsWith(SKILL_TRIGGER)
        ? query.slice(SKILL_TRIGGER.length)
        : query;

      if (!searchTerm) return skillOptions;

      return fuse
        .search(searchTerm)
        .filter((result) => query.length <= result.item.slashText.length)
        .map((result) => result.item);
    },
    [skillOptions, fuse],
  );

  return {
    skillOptions,
    searchSkills,
    hasSkills: skillOptions.length > 0,
  };
}
