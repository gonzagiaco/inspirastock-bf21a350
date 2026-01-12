import { create } from "zustand";

interface NavigationBlockState {
  isBlocked: boolean;
  onBlockedNavigation: (() => void) | null;
  setBlocked: (blocked: boolean, callback?: () => void) => void;
  triggerBlockedNavigation: () => boolean; // Returns true if navigation was blocked
  clearBlock: () => void;
}

export const useNavigationBlock = create<NavigationBlockState>((set, get) => ({
  isBlocked: false,
  onBlockedNavigation: null,
  setBlocked: (blocked, callback) => set({ 
    isBlocked: blocked, 
    onBlockedNavigation: callback || null 
  }),
  triggerBlockedNavigation: () => {
    const state = get();
    if (state.isBlocked && state.onBlockedNavigation) {
      state.onBlockedNavigation();
      return true;
    }
    return false;
  },
  clearBlock: () => set({ isBlocked: false, onBlockedNavigation: null }),
}));
