import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AppState,
  AppActions,
  BackendConfig,
  AppMode,
  ThemeMode,
  PanelState,
} from "../types";
import { MockAdapter } from "../adapters/MockAdapter";
import { generateId } from "../utils";

interface AppStore extends AppState, AppActions {}

const initialState: AppState = {
  // Backend management
  backends: [],
  activeBackendId: null,

  // Navigation
  currentPath: "/",
  navigationHistory: ["/"],
  expandedPaths: new Set<string>(),

  // UI state
  panels: {
    left: true,
    right: false,
    bottom: false,
  },
  theme: "system",
  mode: "filesystem",

  // Search
  searchQuery: "",
  searchHistory: [],
  searchResults: [],

  // Watched paths
  watchedPaths: [],
};

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Backend actions
      addBackend: (config) => {
        const newBackend: BackendConfig = {
          id: generateId(),
          ...config,
        };

        set((state) => ({
          backends: [...state.backends, newBackend],
          // Set as active if it's the first backend
          activeBackendId:
            state.backends.length === 0 ? newBackend.id : state.activeBackendId,
        }));
      },

      removeBackend: (id) => {
        set((state) => {
          const filteredBackends = state.backends.filter((b) => b.id !== id);
          return {
            backends: filteredBackends,
            // If removing active backend, switch to first available or null
            activeBackendId:
              state.activeBackendId === id
                ? filteredBackends.length > 0
                  ? filteredBackends[0].id
                  : null
                : state.activeBackendId,
          };
        });
      },

      setActiveBackend: (id) => {
        const backend = get().backends.find((b) => b.id === id);
        if (backend) {
          set({ activeBackendId: id });
        }
      },

      // Navigation actions
      navigateToPath: (path) => {
        set((state) => {
          const history = [...state.navigationHistory];

          // Don't add duplicate consecutive paths
          if (history[history.length - 1] !== path) {
            history.push(path);
          }

          // Limit history size
          if (history.length > 50) {
            history.shift();
          }

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

      // UI actions
      togglePanel: (panel) => {
        set((state) => ({
          panels: {
            ...state.panels,
            [panel]: !state.panels[panel],
          },
        }));
      },

      setTheme: (theme) => {
        set({ theme });

        // Apply theme to document
        const root = document.documentElement;
        if (theme === "dark") {
          root.classList.add("dark");
        } else if (theme === "light") {
          root.classList.remove("dark");
        } else {
          // System theme
          const isDark = window.matchMedia(
            "(prefers-color-scheme: dark)",
          ).matches;
          if (isDark) {
            root.classList.add("dark");
          } else {
            root.classList.remove("dark");
          }
        }
      },

      setMode: (mode) => {
        set({ mode });

        // Clear search results when switching away from search mode
        if (mode !== "search") {
          set({ searchResults: [], searchQuery: "" });
        }
      },

      // Search actions
      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      addToSearchHistory: (query) => {
        if (!query.trim()) return;

        set((state) => {
          const history = [...state.searchHistory];

          // Remove existing occurrence
          const existingIndex = history.indexOf(query);
          if (existingIndex >= 0) {
            history.splice(existingIndex, 1);
          }

          // Add to beginning
          history.unshift(query);

          // Limit history size
          if (history.length > 20) {
            history.pop();
          }

          return { searchHistory: history };
        });
      },

      clearSearchResults: () => {
        set({ searchResults: [] });
      },

      // Watched paths actions
      addWatchedPath: (path) => {
        set((state) => {
          if (!state.watchedPaths.includes(path)) {
            return {
              watchedPaths: [...state.watchedPaths, path],
            };
          }
          return state;
        });
      },

      removeWatchedPath: (path) => {
        set((state) => ({
          watchedPaths: state.watchedPaths.filter((p) => p !== path),
        }));
      },
    }),
    {
      name: "b3nd-explorer-state",
      partialize: (state) => ({
        // Persist only certain parts of state
        backends: state.backends.map((b) => ({
          id: b.id,
          name: b.name,
          type: b.adapter.type,
          baseUrl: b.adapter.baseUrl,
          isActive: b.isActive,
        })),
        activeBackendId: state.activeBackendId,
        panels: state.panels,
        theme: state.theme,
        searchHistory: state.searchHistory,
        watchedPaths: state.watchedPaths,
        // Don't persist navigation state, search results, or expanded paths
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Recreate adapters for persisted backends
          state.backends = state.backends.map((backendConfig: any) => {
            let adapter;
            switch (backendConfig.type) {
              case "mock":
                adapter = new MockAdapter();
                break;
              case "http":
                // TODO: Recreate HTTP adapter with baseUrl
                adapter = {
                  name: backendConfig.name,
                  type: "http",
                  baseUrl: backendConfig.baseUrl,
                  listPath: async () => ({
                    data: [],
                    pagination: {
                      page: 1,
                      limit: 50,
                      total: 0,
                      hasNext: false,
                      hasPrev: false,
                    },
                  }),
                  readRecord: async () => ({ ts: Date.now(), data: {} }),
                  searchPaths: async () => ({
                    data: [],
                    pagination: {
                      page: 1,
                      limit: 20,
                      total: 0,
                      hasNext: false,
                      hasPrev: false,
                    },
                  }),
                  getSchema: async () => ({}),
                  healthCheck: async () => true,
                };
                break;
              default:
                adapter = {
                  name: "Unknown",
                  type: "unknown",
                  listPath: async () => ({
                    data: [],
                    pagination: {
                      page: 1,
                      limit: 50,
                      total: 0,
                      hasNext: false,
                      hasPrev: false,
                    },
                  }),
                  readRecord: async () => ({ ts: Date.now(), data: {} }),
                  searchPaths: async () => ({
                    data: [],
                    pagination: {
                      page: 1,
                      limit: 20,
                      total: 0,
                      hasNext: false,
                      hasPrev: false,
                    },
                  }),
                  getSchema: async () => ({}),
                  healthCheck: async () => false,
                };
            }
            return {
              ...backendConfig,
              adapter,
            };
          });

          // Initialize default backend if none exist
          if (state.backends.length === 0) {
            const mockBackend: BackendConfig = {
              id: generateId(),
              name: "Local Mock Data",
              adapter: new MockAdapter(),
              isActive: true,
            };
            state.backends = [mockBackend];
            state.activeBackendId = mockBackend.id;
          } else {
            // Ensure active backend has adapter
            const activeBackend = state.backends.find(
              (b) => b.id === state.activeBackendId,
            );
            if (activeBackend && !activeBackend.adapter) {
              // Recreate if missing
              const config = state.backends.find(
                (b) => b.id === state.activeBackendId,
              );
              let adapter;
              switch (config?.type) {
                case "mock":
                  adapter = new MockAdapter();
                  break;
                // ... other cases
                default:
                  adapter = new MockAdapter(); // Default to mock
              }
              const index = state.backends.findIndex(
                (b) => b.id === state.activeBackendId,
              );
              state.backends[index] = { ...state.backends[index], adapter };
            }
          }

          // Apply theme on rehydration
          const theme = state.theme || "system";
          const root = document.documentElement;
          if (theme === "dark") {
            root.classList.add("dark");
          } else if (theme === "light") {
            root.classList.remove("dark");
          } else {
            // System theme
            const isDark = window.matchMedia(
              "(prefers-color-scheme: dark)",
            ).matches;
            if (isDark) {
              root.classList.add("dark");
            } else {
              root.classList.remove("dark");
            }
          }

          // Reset runtime state
          state.currentPath = "/";
          state.navigationHistory = ["/"];
          state.expandedPaths = new Set();
          state.searchQuery = "";
          state.searchResults = [];
          state.mode = "filesystem";
        }
      },
    },
  ),
);

// Helper to get current active backend
export const useActiveBackend = () => {
  const { backends, activeBackendId } = useAppStore();
  return backends.find((b) => b.id === activeBackendId) || null;
};
