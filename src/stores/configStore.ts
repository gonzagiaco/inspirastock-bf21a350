import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ConfigStore {
  autoAddLowStockToCart: boolean;
  dismissedLowStockIds: string[];
  setAutoAddLowStockToCart: (value: boolean) => void;
  addDismissedLowStockIds: (ids: string[]) => void;
  removeDismissedLowStockIds: (ids: string[]) => void;
  clearDismissedLowStockIds: () => void;
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set) => ({
      autoAddLowStockToCart: false,
      dismissedLowStockIds: [],
      setAutoAddLowStockToCart: (value) => set({ autoAddLowStockToCart: value }),
      addDismissedLowStockIds: (ids) =>
        set((state) => {
          const next = new Set(state.dismissedLowStockIds);
          ids.filter(Boolean).forEach((id) => next.add(id));
          return { dismissedLowStockIds: Array.from(next) };
        }),
      removeDismissedLowStockIds: (ids) =>
        set((state) => {
          if (!ids.length) return state;
          const toRemove = new Set(ids);
          return {
            dismissedLowStockIds: state.dismissedLowStockIds.filter((id) => !toRemove.has(id)),
          };
        }),
      clearDismissedLowStockIds: () => set({ dismissedLowStockIds: [] }),
    }),
    { name: "app-config" },
  ),
);
