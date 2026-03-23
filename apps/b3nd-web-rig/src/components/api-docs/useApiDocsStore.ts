import { create } from "zustand";

interface ApiDocsStore {
  activeLibrary: string | null;
  activeSymbol: string | null;
  kindFilter: string | null;

  openLibrary: (key: string) => void;
  closeLibrary: () => void;
  setActiveSymbol: (name: string | null) => void;
  setKindFilter: (kind: string | null) => void;
}

export const useApiDocsStore = create<ApiDocsStore>((set) => ({
  activeLibrary: null,
  activeSymbol: null,
  kindFilter: null,

  openLibrary: (key) => set({ activeLibrary: key, activeSymbol: null, kindFilter: null }),
  closeLibrary: () => set({ activeLibrary: null, activeSymbol: null, kindFilter: null }),
  setActiveSymbol: (name) => set({ activeSymbol: name }),
  setKindFilter: (kind) => set({ kindFilter: kind }),
}));
