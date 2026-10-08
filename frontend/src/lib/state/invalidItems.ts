import { createWithEqualityFn } from "zustand/traditional";
import type { InvalidItem } from "~/lib/utils/invalidItems";

interface InvalidItemsState {
  /** The backend whose invalid items are shown, none when the dialog is closed */
  sourceName: string | null;
  items: InvalidItem[];
  show: (sourceName: string, items: InvalidItem[]) => void;
  close: () => void;
}

export const useInvalidItemsStore = createWithEqualityFn<InvalidItemsState>()(
  (set) => ({
    sourceName: null,
    items: [],
    show: (sourceName, items) => set({ sourceName, items }),
    close: () => set({ sourceName: null, items: [] }),
  }),
);
