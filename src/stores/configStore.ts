import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ConfigStore {
  autoAddLowStockToCart: boolean;
  setAutoAddLowStockToCart: (value: boolean) => void;
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set) => ({
      autoAddLowStockToCart: false,
      setAutoAddLowStockToCart: (value) => set({ autoAddLowStockToCart: value }),
    }),
    { name: "app-config" },
  ),
);
