import isEqual from "lodash.isequal";
import { useShallow } from "zustand/react/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/vanilla/shallow";
import type { Selector } from "./app";

export type UserType = "Admin" | "Developer" | "User";

export type SharingLevel = "none" | "receive" | "share";

/** What the roles an admin assigned the user let them do (login, validate-and-sync, /app/access). */
export type UserAccess = {
  user_type: UserType | null;
  sharing: SharingLevel;
  excel_add_in: boolean;
};

/** Today's usage against the user's limits; a null limit is no limit. */
export type Usage = {
  number_copilot_calls_day_count: number;
  number_copilot_tokens_day_count: number;
  total_file_upload_size_gb_count: number;
  copilot_calls_limit: number | null;
  copilot_tokens_limit: number | null;
  file_upload_size_limit: number | null;
};

/** Admins and developers bring their own connections; users work with what roles give them. */
export function canAddConnections(access: UserAccess | null): boolean {
  return access?.user_type === "Admin" || access?.user_type === "Developer";
}

export function canShare(access: UserAccess | null): boolean {
  return access?.sharing === "share";
}

export function canReceiveShares(access: UserAccess | null): boolean {
  return access?.sharing === "receive" || access?.sharing === "share";
}

type AccessState = {
  access: UserAccess | null;
  setAccess: (access: UserAccess) => void;
  canSubmitMarketplace: boolean;
  usage: Usage | null;
  setUsage: (usage: Partial<Usage>) => void;
  setAccessAndUsage: (
    access: UserAccess,
    canSubmitMarketplace: boolean,
    usage: Usage | null,
  ) => void;
};

export const useAccessStore = createWithEqualityFn<AccessState>()(
  (set) => ({
    access: null,
    setAccess: (access) => set({ access }),
    canSubmitMarketplace: false,
    usage: null,
    setUsage: (usage) =>
      set((state) => ({ usage: { ...state.usage, ...usage } as Usage })),
    setAccessAndUsage: (access, canSubmitMarketplace, usage) =>
      set({ access, canSubmitMarketplace, usage }),
  }),
  shallow,
);

export function useShallowAccessStore<T>(selector: Selector<AccessState, T>): T {
  return useAccessStore(useShallow(selector), (prev, next) => isEqual(prev, next));
}
