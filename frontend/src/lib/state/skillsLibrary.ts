import isEqual from "lodash.isequal";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { Skill, SkillCatalogEntry, SkillCreate } from "~/types/auth.type";
import type { Selector } from "./app";

export type { Skill } from "~/types/auth.type";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug) && slug.length >= 2 && slug.length <= 50;
}

export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

interface SkillsLibraryState {
  skills: Skill[];
  skillDialogOpen: boolean | string;
  setSkillDialogOpen: (open: boolean | string) => void;
  skillDialogPrefill: Partial<SkillCreate> | null;
  openSkillDialogWithPrefill: (prefill: Partial<SkillCreate>) => void;
  closeSkillDialog: () => void;
  getSkillById: (id: string) => Skill | undefined;
  getSkillBySlug: (slug: string) => Skill | undefined;
  isSlugUnique: (slug: string, excludeId?: string) => boolean;
  getSkillsCatalog: () => SkillCatalogEntry[];
  updateSkills: (skills: Skill[]) => void;
}

export const useSkillsLibraryStore = create<SkillsLibraryState>()(
  subscribeWithSelector((set, get) => ({
    skills: [],
    skillDialogOpen: false,
    skillDialogPrefill: null,
    updateSkills: (skills) => set({ skills }),
    setSkillDialogOpen: (skillDialogOpen) => set({ skillDialogOpen }),
    openSkillDialogWithPrefill: (skillDialogPrefill) =>
      set({ skillDialogPrefill, skillDialogOpen: true }),
    closeSkillDialog: () => set({ skillDialogOpen: false, skillDialogPrefill: null }),
    isSlugUnique: (slug, excludeId) => {
      const { skills } = get();
      return !skills.some(
        (s) => s.slug.toLowerCase() === slug.toLowerCase() && s.id !== excludeId,
      );
    },

    getSkillsCatalog: () => {
      return get().skills.map((skill) => ({
        slug: skill.slug,
        description: skill.description,
        updatedAt: skill.updatedDate,
      }));
    },

    getSkillById: (id) => {
      return get().skills.find((s) => s.id === id);
    },

    getSkillBySlug: (slug) => {
      return get().skills.find((s) => s.slug.toLowerCase() === slug.toLowerCase());
    },
  })),
);

export function useShallowSkillsLibraryStore<T>(
  selector: Selector<SkillsLibraryState, T>,
): T {
  return useStoreWithEqualityFn(
    useSkillsLibraryStore,
    useShallow(selector),
    (prev, next) => isEqual(prev, next),
  );
}
