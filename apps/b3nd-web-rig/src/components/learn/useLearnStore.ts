import { create } from "zustand";
import type { LearnCatalog } from "./skillContent";
import { useAppStore } from "../../stores/appStore";

interface LearnStore {
  catalog: LearnCatalog | null;
  loading: boolean;
  error: string | null;
  dataSource: "b3nd" | "static" | null;

  activeBook: string | null;
  activeSectionId: string | null;

  loadCatalog: () => Promise<void>;
  openBook: (key: string) => void;
  closeBook: () => void;
  setActiveSectionId: (id: string | null) => void;
}

export const useLearnStore = create<LearnStore>((set, get) => ({
  catalog: null,
  loading: false,
  error: null,
  dataSource: null,

  activeBook: null,
  activeSectionId: null,

  loadCatalog: async () => {
    // Skip if already loaded or currently loading
    const { catalog, loading } = get();
    if (catalog || loading) return;

    set({ loading: true, error: null });

    // Resolve B3nd node URL from the active backend
    const appState = useAppStore.getState();
    const activeBackend = appState.backends.find(
      (b) => b.id === appState.activeBackendId,
    );
    const b3ndUrl = activeBackend?.adapter?.baseUrl || "";

    // Try B3nd first
    if (b3ndUrl) {
      try {
        const res = await fetch(
          `${b3ndUrl}/api/v1/read/mutable/open/rig/learn/catalog`,
        );
        if (res.ok) {
          const record = await res.json();
          const data: LearnCatalog = record.data ?? record;
          if (data.books && data.books.length > 0) {
            set({ catalog: data, loading: false, dataSource: "b3nd" });
            return;
          }
        }
      } catch {
        // B3nd unavailable, fall through to static
      }
    }

    // Static file fallback
    try {
      const res = await fetch("/learn/catalog.json");
      if (!res.ok) {
        throw new Error(`Failed to load learn catalog: ${res.status}`);
      }
      const data: LearnCatalog = await res.json();
      set({ catalog: data, loading: false, dataSource: "static" });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  openBook: (key) => set({ activeBook: key, activeSectionId: null }),
  closeBook: () => set({ activeBook: null, activeSectionId: null }),
  setActiveSectionId: (id) => set({ activeSectionId: id }),
}));
