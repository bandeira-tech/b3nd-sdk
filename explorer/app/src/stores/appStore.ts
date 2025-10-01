import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AppState,
  AppActions,
  BackendConfig,
  ThemeMode,
  AppMode,
                                                                          |
                                                                                                  PanelState,
} from "../types";
import { HttpAdapter } from "../adapters/HttpAdapter";
import { generateId } from "../utils";
import { getBrowserInstanceManager } from "../../../../client-sdk/browser.js";

// Load instance configuration
async function loadInstanceConfig() {
  try {
    const response = await fetch("/instances.json");
    if (!response.ok) {
      throw new Error("Failed to load instances config");
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to load instances config:", error);
    // Fallback to default config
    return {
      default: "local-api",
      instances: {
        "local-api": {
          type: "http",
          name: "Local HTTP API",
          baseUrl: "http://localhost:8000",
          instanceId: "default",
        },
      },
    };
  }
}

// Create backend configs from instance manager
async function createBackendsFromConfig() {
  const config = await loadInstanceConfig();
  const manager = getBrowserInstanceManager();
  await manager.initialize(config);

  const backends: BackendConfig[] = [];
  const instanceNames = manager.getInstanceNames();
  const defaultInstance = manager.getDefaultInstance();

  for (const name of instanceNames) {
    const client = manager.getClient(name);
    const instanceConfig = config.instances[name];

    backends.push({
      id: name,
      name: instanceConfig.name || name,
      adapter: new HttpAdapter(
        instanceConfig.type === "http" ? instanceConfig.baseUrl : "",
        instanceConfig.type === "http" ? instanceConfig.instanceId : name
      ),
      isActive: name === defaultInstance,
    });
  }

  return backends;
}

let initialBackends: BackendConfig[] = [];

const initialState: Omit<AppState, "backendsReady"> = {
  backends: initialBackends,
  activeBackendId: "local-api", // Default to local API
  schemas: {},
  rootNodes: [],
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
          set((state) => ({
            backends: [...state.backends, { ...config, id: generateId() }],
          }));
        },

        removeBackend: (id) => {
          set((state) => {
            const newBackends = state.backends.filter((b) => b.id !== id);
            return {
              backends: newBackends,
              activeBackendId:
                state.activeBackendId === id && newBackends.length > 0
                  ? newBackends[0].id
                  : state.activeBackendId,
            };
          });
        },

        setActiveBackend: (id) => {
          set((state) => {
            const backend = state.backends.find((b) => b.id === id);
            if (backend) {
              // Update isActive flags
              const updatedBackends = state.backends.map((b) => ({
                ...b,
                isActive: b.id === id,
              }));
              return {
                backends: updatedBackends,
                activeBackendId: id,
                currentPath: "/", // Reset to root when switching
                navigationHistory: ["/"],
                expandedPaths: new Set(),
                schemas: {}, // Clear schemas when switching
                rootNodes: [], // Clear root nodes when switching
              };
            }
            return state;
          });

          // Load schemas after switching backend
          get().loadSchemas();
        },

        loadSchemas: async () => {
          const state = get();
          const backend = state.backends.find((b) => b.id === state.activeBackendId);

          if (!backend) {
            console.warn("No active backend found");
            return;
          }

          try {
            // Fetch schemas from backend (organized by instance)
            const schemasByInstance = await backend.adapter.getSchema();
            console.log("Loaded schemas by instance:", schemasByInstance);

            // Collect all unique schema URIs from all instances
            const allSchemaUris = new Set<string>();
            for (const instanceSchemas of Object.values(schemasByInstance)) {
              for (const uri of instanceSchemas) {
                allSchemaUris.add(uri);
              }
            }

            // Build root navigation nodes from all schemas
            const rootNodes: import("../types").NavigationNode[] = Array.from(allSchemaUris).map(uri => {
              try {
                const url = new URL(uri);
                const protocol = url.protocol.replace(":", "");
                const domain = url.hostname;
                const path = `/${protocol}/${domain}`;

                return {
                  path,
                  name: `${protocol}://${domain}`,
                  type: "directory" as const,
                  children: undefined, // Lazy load
                };
              } catch (error) {
                console.error(`Failed to parse schema URI: ${uri}`, error);
                return null;
              }
            }).filter((node): node is import("../types").NavigationNode => node !== null);

            console.log("Built root nodes:", rootNodes);

            set({
              schemas: schemasByInstance,
              rootNodes,
            });
          } catch (error) {
            console.error("Failed to load schemas:", error);
          }
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
      onRehydrateStorage: () => async (state) => {
        if (state) {
          // Load backends from configuration
          const backends = await createBackendsFromConfig();
          state.backends = backends;

          // Use saved activeBackendId if valid, otherwise use default from config
          const validBackendId = backends.find(
            (b) => b.id === state.activeBackendId
          )?.id;
          const defaultBackend = backends.find((b) => b.isActive);
          state.activeBackendId = validBackendId || defaultBackend?.id || backends[0]?.id;
          console.log("Rehydration: loaded backends from config, active:", state.activeBackendId);

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
          state.schemas = {};
          state.rootNodes = [];

          state.backendsReady = true;

          // Load schemas asynchronously after rehydration
          setTimeout(() => {
            const store = useAppStore.getState();
            store.loadSchemas();
          }, 0);
        }
      },
    },
  ),
);

export const useActiveBackend = () => {
  const { backends, activeBackendId } = useAppStore();
  return backends.find((b) => b.id === activeBackendId) || null;
};
