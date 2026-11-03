import { isAxiosError } from "axios";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash.isequal";
import { toast } from "sonner";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import {
  deleteThemePreset,
  getThemePresets,
  putActiveThemePreset,
  putThemePreset,
  type ThemePreset,
  type ThemePresets,
} from "~/api/admin.api";
import type { ThemeScope } from "~/lib/theme/properties";
import type { ThemeVariants } from "~/lib/theme/sheet";
import { uuidv4 } from "~/lib/utils";
import type { Selector } from "./app";
import { useEntityThemeStore } from "./entityTheme";

const EMPTY: ThemeVariants = { light: {}, dark: {} };

interface ThemePresetsState {
  presets: ThemePreset[];
  activeId: string | null;
  selectedId: string | null;
  draft: ThemeVariants;
  loaded: boolean;
  load: () => Promise<void>;
  select: (id: string | null) => void;
  setValue: (scope: ThemeScope, name: string, value: string) => void;
  clearValue: (scope: ThemeScope, name: string) => void;
  revert: () => void;
  save: () => Promise<boolean>;
  saveAs: (name: string) => Promise<boolean>;
  rename: (name: string) => Promise<boolean>;
  remove: () => Promise<void>;
  activate: (id: string | null) => Promise<void>;
}

function variantsOf(presets: ThemePreset[], id: string | null): ThemeVariants {
  const preset = presets.find((candidate) => candidate.uuid === id);
  return cloneDeep(preset ? { light: preset.light, dark: preset.dark } : EMPTY);
}

function failure(error: unknown, fallback: string) {
  const detail = isAxiosError(error) ? error.response?.data?.detail : null;
  toast.error(typeof detail === "string" ? detail : fallback);
}

export function savedVariants(
  state: Pick<ThemePresetsState, "presets" | "selectedId">,
): ThemeVariants {
  return variantsOf(state.presets, state.selectedId);
}

export function isDirty(
  state: Pick<ThemePresetsState, "presets" | "selectedId" | "draft">,
): boolean {
  return !isEqual(state.draft, savedVariants(state));
}

async function refreshAppliedTheme() {
  await useEntityThemeStore.getState().updateThemeSettings();
}

export const useThemePresetsStore = createWithEqualityFn<ThemePresetsState>()(
  subscribeWithSelector((set, get) => {
    const adopt = (answer: ThemePresets) =>
      set({ presets: answer.presets, activeId: answer.active_preset });

    return {
      presets: [],
      activeId: null,
      selectedId: null,
      draft: cloneDeep(EMPTY),
      loaded: false,
      load: async () => {
        try {
          const answer = await getThemePresets();
          const { loaded, selectedId, draft } = get();
          const keep =
            loaded &&
            (selectedId === null ||
              answer.presets.some((preset) => preset.uuid === selectedId));
          set({
            presets: answer.presets,
            activeId: answer.active_preset,
            loaded: true,
            selectedId: keep ? selectedId : answer.active_preset,
            draft: keep ? draft : variantsOf(answer.presets, answer.active_preset),
          });
        } catch (error) {
          failure(error, "Could not load the theme presets");
        }
      },
      select: (id) =>
        set((state) => ({ selectedId: id, draft: variantsOf(state.presets, id) })),
      setValue: (scope, name, value) =>
        set((state) => ({
          draft: { ...state.draft, [scope]: { ...state.draft[scope], [name]: value } },
        })),
      clearValue: (scope, name) =>
        set((state) => {
          const { [name]: _removed, ...rest } = state.draft[scope];
          return { draft: { ...state.draft, [scope]: rest } };
        }),
      revert: () => set((state) => ({ draft: savedVariants(state) })),
      save: async () => {
        const { selectedId, presets, draft, activeId } = get();
        const preset = presets.find((candidate) => candidate.uuid === selectedId);
        if (!preset) return false;
        try {
          const saved = await putThemePreset({ ...preset, ...cloneDeep(draft) });
          set({ presets: presets.map((p) => (p.uuid === saved.uuid ? saved : p)) });
          if (activeId === saved.uuid) await refreshAppliedTheme();
          toast.success(`Saved the preset ${saved.name}`);
          return true;
        } catch (error) {
          failure(error, "Could not save the theme preset");
          return false;
        }
      },
      saveAs: async (name) => {
        try {
          const saved = await putThemePreset({
            uuid: uuidv4(),
            name,
            ...cloneDeep(get().draft),
          });
          set((state) => ({
            presets: [...state.presets, saved],
            selectedId: saved.uuid,
            draft: variantsOf([saved], saved.uuid),
          }));
          toast.success(`Saved the preset ${saved.name}`);
          return true;
        } catch (error) {
          failure(error, "Could not save the theme preset");
          return false;
        }
      },
      rename: async (name) => {
        const { selectedId, presets } = get();
        const preset = presets.find((candidate) => candidate.uuid === selectedId);
        if (!preset) return false;
        try {
          const saved = await putThemePreset({ ...preset, name });
          set({ presets: presets.map((p) => (p.uuid === saved.uuid ? saved : p)) });
          return true;
        } catch (error) {
          failure(error, "Could not rename the theme preset");
          return false;
        }
      },
      remove: async () => {
        const { selectedId, activeId } = get();
        if (!selectedId) return;
        try {
          const answer = await deleteThemePreset(selectedId);
          adopt(answer);
          set({ selectedId: null, draft: cloneDeep(EMPTY) });
          if (activeId === selectedId) await refreshAppliedTheme();
        } catch (error) {
          failure(error, "Could not delete the theme preset");
        }
      },
      activate: async (id) => {
        try {
          adopt(await putActiveThemePreset(id));
          await refreshAppliedTheme();
          toast.success(
            id ? "The preset now applies to everyone" : "The FINOS theme now applies",
          );
        } catch (error) {
          failure(error, "Could not apply the theme preset");
        }
      },
    };
  }),
  shallow,
);

export function useShallowThemePresetsStore<T>(
  selector: Selector<ThemePresetsState, T>,
): T {
  return useThemePresetsStore(useShallow(selector), (prev, next) =>
    isEqual(prev, next),
  );
}
