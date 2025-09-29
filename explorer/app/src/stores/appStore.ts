import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AppState,
  AppActions,
  BackendConfig,
  ThemeMode,
  AppMode,
  PanelState,
} from "../types";
import { MockAdapter } from "../adapters/MockAdapter";
import { generateId } from "../utils";

const createMockBackend = (): BackendConfig => ({
  id: "mock-default", // Fixed ID for simplicity
  name: "Local Mock Data",
  adapter: new MockAdapter(),
  isActive: true,
});

const initialBackends = [createMockBackend()];

const initialState: Omit<AppState, "backendsReady"> = {
  backends: initialBackends,
  activeBackendId: initialBackends[0].id,
  currentPath: "/",
  navigationHistory: ["/"],
  expandedPaths: new Set<string>(),
  panels: {
    left: true,
    right: false,
    bottom: false,
  },
  theme: "system" as ThemeMode,
  mode: "filesystem" as AppMode,
  searchQuery: "",
  searchHistory: [],
  searchResults: [],
  watchedPaths: [],
};

interface AppStore extends AppState, AppActions {
  backendsReady: boolean;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => {
      console.log("Store init: created fresh MockAdapter");
      return {
        ...initialState,
        backendsReady: true,

        addBackend: (config) => {
          // For now, ignore – always use mock
          console.log("addBackend ignored – using mock only");
        },

        removeBackend: (id) => {
          // Ignore – always have mock
          console.log("removeBackend ignored – using mock only");
        },

        setActiveBackend: (id) => {
          // Ignore – always mock
          console.log("setActiveBackend ignored – using mock only");
        },

        navigateToPath: (path) => {
          console.log("Navigating to:", path);
          set((state) => {
            const history = [...state.navigationHistory];
            if (history[history.length - 1] !== path) {
              history.push(path);
            }
            if (history.length > 50) history.shift();
            return {
              currentPath: path,
              navigationHistory: history,
            };
          });
        },

        togglePathExpansion: (path) => {
          set((state) => {
            const expanded = new Set(state.expandedPaths);
            if (expanded.has(path)) {
              expanded.delete(path);
            } else {
              expanded.add(path);
            }
            return { expandedPaths: expanded };
          });
        },

        goBack: () => {
          set((state) => {
            const history = [...state.navigationHistory];
            const currentIndex = history.lastIndexOf(state.currentPath);
            if (currentIndex > 0) {
              const previousPath = history[currentIndex - 1];
              return { currentPath: previousPath };
            }
            return state;
          });
        },

        goForward: () => {
          set((state) => {
            const history = [...state.navigationHistory];
            const currentIndex = history.lastIndexOf(state.currentPath);
            if (currentIndex < history.length - 1) {
              const nextPath = history[currentIndex + 1];
              return { currentPath: nextPath };
            }
            return state;
          });
        },

        togglePanel: (panel: keyof PanelState) => {
          set((state) => ({
            panels: {
              ...state.panels,
              [panel]: !state.panels[panel],
            },
          }));
        },

        setTheme: (theme: ThemeMode) => {
          set({ theme });

          const root = document.documentElement;
          if (theme === "dark") {
            root.classList.add("dark");
          } else if (theme === "light") {
            root.classList.remove("dark");
          } else {
            const isDark = window.matchMedia(
              "(prefers-color-scheme: dark)",
            ).matches;
            root.classList.toggle("dark", isDark);
          }
        },

        setMode: (mode: AppMode) => {
          set({ mode });
          if (mode !== "search") {
            set({ searchResults: [], searchQuery: "" });
          }
        },

        setSearchQuery: (query: string) => {
          set({ searchQuery: query });
        },

        addToSearchHistory: (query: string) => {
          if (!query.trim()) return;
          set((state) => {
            const history = [...state.searchHistory];
            const existingIndex = history.indexOf(query);
            if (existingIndex >= 0) history.splice(existingIndex, 1);
            history.unshift(query);
            if (history.length > 20) history.pop();
            return { searchHistory: history };
          });
        },

        clearSearchResults: () => {
          set({ searchResults: [] });
        },

        addWatchedPath: (path: string) => {
          set((state) => {
            if (!state.watchedPaths.includes(path)) {
              return { watchedPaths: [...state.watchedPaths, path] };
            }
            return state;
          });
        },

        removeWatchedPath: (path: string) => {
          set((state) => ({
            watchedPaths: state.watchedPaths.filter((p) => p !== path),
          }));
        },
      };
    },
    {
      name: "b3nd-explorer-state",
      partialize: (state) => ({
        // Exclude backends entirely – always recreate fresh
        activeBackendId: state.activeBackendId,
        panels: state.panels,
        theme: state.theme,
        searchHistory: state.searchHistory,
        watchedPaths: state.watchedPaths,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Recreate fresh backends on load
          state.backends = initialBackends;
          state.activeBackendId = initialBackends[0].id;
          console.log("Rehydration: recreated fresh MockAdapter");

          // Apply theme
          const theme = state.theme || "system";
          const root = document.documentElement;
          if (theme === "dark") root.classList.add("dark");
          else if (theme === "light") root.classList.remove("dark");
          else {
            const isDark = window.matchMedia(
              "(prefers-color-scheme: dark)",
            ).matches;
            root.classList.toggle("dark", isDark);
          }

          // Reset runtime state
          state.currentPath = "/";
          state.navigationHistory = ["/"];
          state.expandedPaths = new Set();
          state.searchQuery = "";
          state.searchResults = [];
          state.mode = "filesystem";

          state.backendsReady = true;
        }
      },
    },
  ),
);

export const useActiveBackend = () => {
  const { backends, activeBackendId } = useAppStore();
  return backends.find((b) => b.id === activeBackendId) || null;
};
