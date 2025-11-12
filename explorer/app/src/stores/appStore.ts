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
import { HttpAdapter } from "../adapters/HttpAdapter";
import { generateId } from "../utils";
// Using latest sdk HttpClient via HttpAdapter; no external client manager

// Serializable backend config for persistence
interface SerializableBackendConfig {
  id: string;
  name: string;
  type: "http";
  baseUrl: string;
  instanceId: string;
  isActive: boolean;
}

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

// Create backend configs directly from instances.json
async function createBackendsFromConfig(): Promise<BackendConfig[]> {
  const config = await loadInstanceConfig();
  const backends: BackendConfig[] = [];

  const defaultInstance: string | undefined = (config as any).default;
  const instances = (config as any).instances || {};

  for (const name of Object.keys(instances)) {
    const instanceConfig = instances[name];
    if (instanceConfig.type === "http") {
      const baseUrl: string = instanceConfig.baseUrl;
      const instanceId: string = instanceConfig.instanceId;
      backends.push({
        id: name,
        name: instanceConfig.name || name,
        adapter: new HttpAdapter(baseUrl, instanceId),
        isActive: name === defaultInstance,
      });
    }
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
      return {
        ...initialState,
        backendsReady: true,

        addBackend: (config) => {
          set((state) => {
            // Mark adapter as user-added for persistence
            const adapter = config.adapter;
            (adapter as any).isUserAdded = true;

            return {
              backends: [...state.backends, { ...config, id: generateId(), adapter }],
            };
          });
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

          console.log("[loadSchemas] Called. ActiveBackendId:", state.activeBackendId, "Backend found:", !!backend);

          if (!backend) {
            console.warn("[loadSchemas] No active backend found");
            return;
          }

          try {
            console.log("[loadSchemas] Fetching schema from", backend.name);

            // Add timeout to prevent hanging indefinitely
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("Schema fetch timeout after 10s")), 10000);
            });

            // Fetch schemas from backend (organized by instance) with timeout
            const schemasByInstance = await Promise.race([
              backend.adapter.getSchema(),
              timeoutPromise
            ]);
            console.log("[loadSchemas] Raw response:", schemasByInstance);

            // Collect all unique schema URIs from all instances
            const allSchemaUris = new Set<string>();
            for (const instanceSchemas of Object.values(schemasByInstance)) {
              if (Array.isArray(instanceSchemas)) {
                for (const uri of instanceSchemas) {
                  allSchemaUris.add(uri);
                }
              }
            }

            console.log("[loadSchemas] Collected URIs:", Array.from(allSchemaUris));

            // Build root navigation nodes from all schemas
            const nodes: import("../types").NavigationNode[] = [];
            for (const uri of allSchemaUris) {
              try {
                const url = new URL(uri);
                const protocol = url.protocol.replace(":", "");
                const domain = url.hostname;
                const path = `/${protocol}/${domain}`;
                nodes.push({ path, name: `${protocol}://${domain}`, type: "directory" });
              } catch (error) {
                console.error(`[loadSchemas] Failed to parse schema URI: ${uri}`, error);
              }
            }

            console.log("[loadSchemas] Built root nodes:", nodes);

            set({
              schemas: schemasByInstance,
              rootNodes: nodes,
            });
          } catch (error) {
            console.error("[loadSchemas] Failed to load schemas:", error);
            // Set empty schemas/rootNodes on error so the app can still be used
            set({
              schemas: {},
              rootNodes: [],
            });
          }
        },

        navigateToPath: (path) => {
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
      partialize: (state) => {
        // Serialize user-added backends (those not from instances.json)
        const userBackends: SerializableBackendConfig[] = state.backends
          .filter((b) => b.adapter.type === "http" && (b.adapter as any).isUserAdded)
          .map((b) => ({
            id: b.id,
            name: b.name,
            type: "http" as const,
            baseUrl: b.adapter.baseUrl || "",
            instanceId: (b.adapter as any).instanceId || "default",
            isActive: b.isActive,
          }));

        return {
          activeBackendId: state.activeBackendId,
          panels: state.panels,
          theme: state.theme,
          searchHistory: state.searchHistory,
          watchedPaths: state.watchedPaths,
          userBackends, // Add user backends to persisted state
        };
      },
      onRehydrateStorage: () => async (state) => {
        console.log("[onRehydrate] Starting rehydration");
        if (state) {
          // Load backends from configuration
          const backends = await createBackendsFromConfig();
          console.log("[onRehydrate] Loaded backends from config:", backends.map(b => b.id));

          // Restore user-added backends from localStorage
          const userBackends: SerializableBackendConfig[] = (state as any).userBackends || [];
          const restoredUserBackends: BackendConfig[] = userBackends.map((b) => ({
            id: b.id,
            name: b.name,
            adapter: Object.assign(new HttpAdapter(b.baseUrl, b.instanceId), { isUserAdded: true }),
            isActive: b.isActive,
          }));

          // Combine system backends with user backends
          state.backends = [...backends, ...restoredUserBackends];
          console.log("[onRehydrate] Total backends after merge:", state.backends.map(b => b.id));

          // Use saved activeBackendId if valid (check both system and user backends)
          const allBackends = [...backends, ...restoredUserBackends];
          const validBackendId = allBackends.find(
            (b) => b.id === state.activeBackendId
          )?.id;
          const defaultBackend = backends.find((b) => b.isActive);
          state.activeBackendId = validBackendId || defaultBackend?.id || allBackends[0]?.id;
          console.log("[onRehydrate] Set activeBackendId to:", state.activeBackendId);

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

          console.log("[onRehydrate] Scheduling loadSchemas call");
          // Load schemas asynchronously after rehydration
          setTimeout(() => {
            console.log("[onRehydrate] Executing loadSchemas from setTimeout");
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
