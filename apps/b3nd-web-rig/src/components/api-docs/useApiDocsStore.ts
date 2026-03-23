import { create } from "zustand";
import type { ApiCatalog } from "./apiDocsTypes";

interface ApiDocsStore {
  activeLibrary: string | null;
  activeSymbol: string | null;
  kindFilter: string | null;
  catalog: ApiCatalog | null;
  catalogLoading: boolean;
  catalogError: string | null;

  openLibrary: (key: string) => void;
  closeLibrary: () => void;
  setActiveSymbol: (name: string | null) => void;
  setKindFilter: (kind: string | null) => void;
  setCatalog: (catalog: ApiCatalog) => void;
  setCatalogError: (error: string) => void;
  setCatalogLoading: (loading: boolean) => void;
}

export const useApiDocsStore = create<ApiDocsStore>((set) => ({
  activeLibrary: null,
  activeSymbol: null,
  kindFilter: null,
  catalog: null,
  catalogLoading: false,
  catalogError: null,

  openLibrary: (key) => set({ activeLibrary: key, activeSymbol: null, kindFilter: null }),
  closeLibrary: () => set({ activeLibrary: null, activeSymbol: null, kindFilter: null }),
  setActiveSymbol: (name) => set({ activeSymbol: name }),
  setKindFilter: (kind) => set({ kindFilter: kind }),
  setCatalog: (catalog) => set({ catalog, catalogLoading: false, catalogError: null }),
  setCatalogError: (error) => set({ catalogError: error, catalogLoading: false }),
  setCatalogLoading: (loading) => set({ catalogLoading: loading }),
}));
