import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RequestItem } from "@/types";

interface RequestCartStore {
  requestList: RequestItem[];
  setRequestList: (items: RequestItem[]) => void;
  addOrIncrement: (item: RequestItem) => void;
  updateQuantity: (id: string, quantity: number, options?: { manualOverride?: boolean }) => void;
  updateItemPrice: (productId: string, newPrice: number) => void;
  removeItem: (id: string) => void;
  clear: () => void;
}

export const useRequestCartStore = create<RequestCartStore>()(
  persist(
    (set) => ({
      requestList: [],
      setRequestList: (items) => set({ requestList: items }),
      addOrIncrement: (item) =>
        set((state) => {
          const existing = state.requestList.find((r) => r.productId === item.productId);
          if (existing) {
            return {
              requestList: state.requestList.map((r) =>
                r.productId === item.productId ? { ...r, quantity: r.quantity + item.quantity } : r,
              ),
            };
          }
          return { requestList: [...state.requestList, item] };
        }),
      updateQuantity: (id, quantity, options) =>
        set((state) => ({
          requestList: state.requestList.map((item) =>
            item.id === id
              ? {
                  ...item,
                  quantity,
                  manualOverride: options?.manualOverride ? true : item.manualOverride,
                }
              : item,
          ),
        })),
      updateItemPrice: (productId, newPrice) =>
        set((state) => ({
          requestList: state.requestList.map((item) =>
            item.productId === productId ? { ...item, costPrice: newPrice } : item,
          ),
        })),
      removeItem: (id) =>
        set((state) => ({ requestList: state.requestList.filter((item) => item.id !== id) })),
      clear: () => set({ requestList: [] }),
    }),
    { name: "request-cart" },
  ),
);
