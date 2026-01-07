import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AppActions,
  AppExperience,
  AppMainView,
  AppMode,
  AppState,
  BackendConfig,
  EndpointConfig,
  ManagedAccount,
  PanelState,
  ThemeMode,
  WriterSection,
  WriterUserSession,
  WriterAppSession,
  ExplorerSection,
} from "../types";
import { HttpAdapter } from "../adapters/HttpAdapter";
import { generateId, joinPath, sanitizePath } from "../utils";
// Using latest sdk HttpClient via HttpAdapter; no external client manager

// Serializable backend config for persistence
interface SerializableBackendConfig {
  id: string;
  name: string;
  type: "http";
  baseUrl: string;
  isActive: boolean;
}

interface InstancesConfig {
  defaults?: {
    backend?: string;
    wallet?: string;
    appServer?: string;
  };
  backends?: Record<string, { name?: string; baseUrl?: string }>;
  walletServers?: Record<string, { name?: string; url?: string }>;
  appServers?: Record<string, { name?: string; url?: string }>;
}

// Load instance configuration
async function loadInstanceConfig(): Promise<InstancesConfig> {
  try {
    const response = await fetch("/instances.json");
    if (!response.ok) {
      throw new Error("Failed to load instances config");
    }
    return await response.json() as InstancesConfig;
  } catch (error) {
    console.error("Failed to load instances config:", error);
    // Fallback to default config
    return {
      defaults: {
        backend: "local-api",
        wallet: "local-wallet",
        appServer: "local-app",
      },
      backends: {
        "local-api": { name: "Local HTTP API", baseUrl: "http://localhost:8842" },
      },
      walletServers: {
        "local-wallet": { name: "Local Wallet", url: "http://localhost:8843" },
      },
      appServers: {
        "local-app": { name: "Local App Server", url: "http://localhost:8844" },
      },
    };
  }
}

async function loadAllEndpoints(): Promise<{
  backends: BackendConfig[];
  walletServers: EndpointConfig[];
  appServers: EndpointConfig[];
  defaults: { backend?: string; wallet?: string; appServer?: string };
}> {
  const config = await loadInstanceConfig();

  const backends: BackendConfig[] = [];
  if (config.backends) {
    const defaultBackendId = config.defaults?.backend;
    for (const id of Object.keys(config.backends)) {
      const entry = config.backends[id];
      if (!entry?.baseUrl) continue;
      backends.push({
        id,
        name: entry.name || id,
        adapter: new HttpAdapter(entry.baseUrl),
        isActive: id === defaultBackendId,
      });
    }
  }

  const walletServers: EndpointConfig[] = [];
  if (config.walletServers) {
    const defaultWalletId = config.defaults?.wallet;
    for (const id of Object.keys(config.walletServers)) {
      const entry = config.walletServers[id];
      if (!entry?.url) continue;
      walletServers.push({
        id,
        name: entry.name || id,
        url: entry.url,
        isActive: id === defaultWalletId,
      });
    }
  }

  const appServers: EndpointConfig[] = [];
  if (config.appServers) {
    const defaultAppId = config.defaults?.appServer;
    for (const id of Object.keys(config.appServers)) {
      const entry = config.appServers[id];
      if (!entry?.url) continue;
      appServers.push({
        id,
        name: entry.name || id,
        url: entry.url,
        isActive: id === defaultAppId,
      });
    }
  }

  return {
    backends,
    walletServers,
    appServers,
    defaults: config.defaults || {},
  };
}

const initialState: Omit<AppState, "backendsReady"> = {
  backends: [],
  activeBackendId: null,
  walletServers: [],
  activeWalletServerId: null,
  appServers: [],
  activeAppServerId: null,
  googleClientId: "",
  keyBundle: {
    appKey: "",
    accountPrivateKeyPem: "",
    encryptionPublicKeyHex: "",
    encryptionPrivateKeyPem: "",
  },
  schemas: {},
  rootNodes: [],
  currentPath: "/",
  explorerSection: "index" as ExplorerSection,
  explorerIndexPath: "/",
  explorerAccountKey: null,
  explorerAccountPath: "/",
  navigationHistory: ["/"],
  expandedPaths: new Set<string>(),
  panels: {
    left: true,
    right: true,
    bottom: false,
  },
  bottomMaximized: false,
  theme: "system" as ThemeMode,
  mode: "filesystem" as AppMode,
  activeApp: "explorer" as AppExperience,
  mainView: "content" as AppMainView,
  writerSection: "backend" as WriterSection,
  writerAppSession: null,
  writerSession: null,
  writerLastResolvedUri: null,
  writerLastAppUri: null,
  writerOutputs: [],
  accounts: [],
  activeAccountId: null,
  formState: {},
  searchQuery: "",
  searchHistory: [],
  searchResults: [],
  watchedPaths: [],
  logs: [],
};

export interface AppStore extends AppState, AppActions {
  backendsReady: boolean;
  panelPreferences: {
    right: Record<string, boolean>;
  };
}

export function rightPanelContextKey(state: AppState): string {
  if (state.mainView === "settings") return "settings";
  if (state.mainView === "accounts") return "accounts";
  if (state.activeApp === "writer") {
    return `writer:${state.writerSection}`;
  }
  if (state.activeApp === "explorer") {
    return `explorer:${state.mode}:${state.explorerSection}`;
  }
  return "global";
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => {
      return {
        ...initialState,
        backendsReady: false,
        panelPreferences: { right: {} },

        addBackend: (config) => {
          set((state) => {
            // Mark adapter as user-added for persistence
            const adapter = config.adapter;
            (adapter as any).isUserAdded = true;

            return {
              backends: [...state.backends, {
                ...config,
                id: generateId(),
                adapter,
              }],
            };
          });
        },

        addWalletServer: (config) => {
          set((state) => ({
            walletServers: [...state.walletServers, {
              ...config,
              id: generateId(),
            }],
          }));
        },

        removeWalletServer: (id) => {
          set((state) => {
            const walletServers = state.walletServers.filter((w) =>
              w.id !== id
            );
            const activeWalletServerId = state.activeWalletServerId === id
              ? walletServers[0]?.id || null
              : state.activeWalletServerId;
            return { walletServers, activeWalletServerId };
          });
        },

        setActiveWalletServer: (id) => {
          set((state) => ({
            activeWalletServerId: id,
            walletServers: state.walletServers.map((w) => ({
              ...w,
              isActive: w.id === id,
            })),
          }));
        },

        addAppServer: (config) => {
          set((state) => ({
            appServers: [...state.appServers, { ...config, id: generateId() }],
          }));
        },

        removeAppServer: (id) => {
          set((state) => {
            const appServers = state.appServers.filter((w) => w.id !== id);
            const activeAppServerId = state.activeAppServerId === id
              ? appServers[0]?.id || null
              : state.activeAppServerId;
            return { appServers, activeAppServerId };
          });
        },

        setActiveAppServer: (id) => {
          set((state) => ({
            activeAppServerId: id,
            appServers: state.appServers.map((w) => ({
              ...w,
              isActive: w.id === id,
            })),
          }));
        },

        setGoogleClientId: (googleClientId: string) => {
          set({ googleClientId });
        },

        setKeyBundle: (bundle) => {
          set((state) => ({
            keyBundle: { ...state.keyBundle, ...bundle },
          }));
        },

        closeSettings: () => {
          set((state) => ({
            panels: { ...state.panels, right: false },
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
                explorerSection: "index" as ExplorerSection,
                explorerIndexPath: "/",
                explorerAccountPath: "/",
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
          const backend = state.backends.find((b) =>
            b.id === state.activeBackendId
          );

          console.log(
            "[loadSchemas] Called. ActiveBackendId:",
            state.activeBackendId,
            "Backend found:",
            !!backend,
          );

          if (!backend) {
            console.warn("[loadSchemas] No active backend found");
            return;
          }

          try {
            console.log("[loadSchemas] Fetching schema from", backend.name);

            // Add timeout to prevent hanging indefinitely
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error("Schema fetch timeout after 10s")),
                10000,
              );
            });

            // Fetch schemas from backend (organized by instance) with timeout
            const schemasByInstance = await Promise.race([
              backend.adapter.getSchema(),
              timeoutPromise,
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

            console.log(
              "[loadSchemas] Collected URIs:",
              Array.from(allSchemaUris),
            );

            // Build root navigation nodes from all schemas
            const nodes: import("../types").NavigationNode[] = [];
            for (const uri of allSchemaUris) {
              try {
                const url = new URL(uri);
                const protocol = url.protocol.replace(":", "");
                const domain = url.hostname;
                const path = `/${protocol}/${domain}`;
                nodes.push({
                  path,
                  name: `${protocol}://${domain}`,
                  type: "directory",
                });
              } catch (error) {
                console.error(
                  `[loadSchemas] Failed to parse schema URI: ${uri}`,
                  error,
                );
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

        navigateToPath: (path, options) => {
          set((state) => {
            const section: ExplorerSection = options?.section || state.explorerSection || "index";
            const nextHistory = [...state.navigationHistory];
            const normalized = sanitizePath(path);

            if (section === "account") {
              const accountKey = options?.accountKey || state.explorerAccountKey;
              if (!accountKey) {
                throw new Error("Account key is required when navigating account explorer paths");
              }
              const segments = normalized.split("/").filter(Boolean);
              if (segments.length === 0) {
                if (nextHistory[nextHistory.length - 1] !== "/") {
                  nextHistory.push("/");
                }
                if (nextHistory.length > 50) nextHistory.shift();
                return {
                  explorerSection: "account" as ExplorerSection,
                  explorerAccountKey: accountKey,
                  explorerAccountPath: "/",
                  currentPath: "/",
                  navigationHistory: nextHistory,
                  mainView: "content",
                };
              }

              const hasProtocol = segments[0] === "mutable" || segments[0] === "immutable";
              const protocol = hasProtocol ? segments[0] : "mutable";
              const remainder = hasProtocol ? segments.slice(1) : segments;
              const resolved = joinPath(protocol, "accounts", accountKey, ...remainder);
              const storedPath = "/" + [protocol, ...remainder].filter(Boolean).join("/");
              if (nextHistory[nextHistory.length - 1] !== resolved) {
                nextHistory.push(resolved);
              }
              if (nextHistory.length > 50) nextHistory.shift();
              return {
                explorerSection: "account" as ExplorerSection,
                explorerAccountKey: accountKey,
                explorerAccountPath: storedPath,
                currentPath: resolved,
                navigationHistory: nextHistory,
                mainView: "content",
              };
            }

            if (nextHistory[nextHistory.length - 1] !== normalized) {
              nextHistory.push(normalized);
            }
            if (nextHistory.length > 50) nextHistory.shift();

            return {
              explorerSection: "index" as ExplorerSection,
              explorerIndexPath: normalized,
              currentPath: normalized,
              navigationHistory: nextHistory,
              mainView: "content",
            };
          });
        },

        setExplorerSection: (section: ExplorerSection) => {
          set((state) => {
            if (section === "account") {
              if (!state.explorerAccountKey) {
                return {
                  explorerSection: section,
                  currentPath: "/",
                };
              }
              const normalized = sanitizePath(state.explorerAccountPath || "/");
              const resolved = joinPath(
                "mutable",
                "accounts",
                state.explorerAccountKey,
                normalized === "/" ? "" : normalized,
              );
              return {
                explorerSection: section,
                currentPath: resolved,
              };
            }
            const nextPath = sanitizePath(state.explorerIndexPath || "/");
            return {
              explorerSection: section,
              currentPath: nextPath,
            };
          });
        },

        setExplorerIndexPath: (path: string) => {
          set((state) => {
            const normalized = sanitizePath(path);
            const history = [...state.navigationHistory];
            if (history[history.length - 1] !== normalized) {
              history.push(normalized);
            }
            if (history.length > 50) history.shift();
            return {
              explorerIndexPath: normalized,
              currentPath: state.explorerSection === "index" ? normalized : state.currentPath,
              navigationHistory: history,
            };
          });
        },

        setExplorerAccountKey: (accountKey: string | null) => {
          set((state) => {
            if (!accountKey) {
              return {
                explorerAccountKey: null,
                currentPath: state.explorerSection === "account" ? "/" : state.currentPath,
              };
            }
            const normalizedPath = sanitizePath(state.explorerAccountPath || "/");
            const resolved = joinPath("mutable", "accounts", accountKey, normalizedPath === "/" ? "" : normalizedPath);
            return {
              explorerAccountKey: accountKey,
              currentPath: state.explorerSection === "account" ? resolved : state.currentPath,
            };
          });
        },

        setExplorerAccountPath: (path: string) => {
          set((state) => {
            const normalized = sanitizePath(path);
            const history = [...state.navigationHistory];
            const accountKey = state.explorerAccountKey;
            if (!accountKey) {
              throw new Error("Account key is required when setting the account explorer path");
            }
            const segments = normalized.split("/").filter(Boolean);
            if (segments.length === 0) {
              if (history[history.length - 1] !== "/") {
                history.push("/");
              }
              if (history.length > 50) history.shift();
              return {
                explorerAccountPath: "/",
                currentPath: state.explorerSection === "account" ? "/" : state.currentPath,
                navigationHistory: history,
              };
            }
            const hasProtocol = segments[0] === "mutable" || segments[0] === "immutable";
            const protocol = hasProtocol ? segments[0] : "mutable";
            const remainder = hasProtocol ? segments.slice(1) : segments;
            const resolved = joinPath(protocol, "accounts", accountKey, ...remainder);
            const storedPath = "/" + [protocol, ...remainder].filter(Boolean).join("/");
            if (history[history.length - 1] !== resolved) {
              history.push(resolved);
            }
            if (history.length > 50) history.shift();

            return {
              explorerAccountPath: storedPath,
              currentPath: state.explorerSection === "account" ? resolved : state.currentPath,
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
          set((state) => {
            if (panel === "right") {
              const key = rightPanelContextKey(state);
              const next = !state.panels.right;
              return {
                panels: { ...state.panels, right: next },
                panelPreferences: {
                  ...state.panelPreferences,
                  right: { ...state.panelPreferences.right, [key]: next },
                },
              };
            }
            return {
              panels: {
                ...state.panels,
                [panel]: !state.panels[panel],
              },
            };
          });
        },

        setPanelOpen: (panel: keyof PanelState, open: boolean) => {
          set((state) => {
            if (panel === "right") {
              const key = rightPanelContextKey(state);
              return {
                panels: { ...state.panels, right: open },
                panelPreferences: {
                  ...state.panelPreferences,
                  right: { ...state.panelPreferences.right, [key]: open },
                },
              };
            }
            return {
              panels: {
                ...state.panels,
                [panel]: open,
              },
            };
          });
        },

        toggleBottomPanelMaximized: () => {
          set((state) => ({
            panels: { ...state.panels, bottom: true },
            bottomMaximized: !state.bottomMaximized,
          }));
        },

        ensureRightPanelOpen: () => {
          set((state) => {
            const key = rightPanelContextKey(state);
            if (state.panels.right) return state;
            return {
              panels: { ...state.panels, right: true },
              panelPreferences: {
                ...state.panelPreferences,
                right: { ...state.panelPreferences.right, [key]: true },
              },
            };
          });
        },

        applyRightPanelPreference: (keyOverride?: string) => {
          const currentState = get();
          const key = keyOverride || rightPanelContextKey(currentState);
          const preferred = currentState.panelPreferences.right[key];
          const next = preferred === undefined ? true : preferred;
          if (currentState.panels.right === next) return;
          set((state) => {
            if (state.panels.right === next) return state;
            return {
              panels: { ...state.panels, right: next },
            };
          });
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

        setActiveApp: (activeApp: AppExperience) => {
          set(() => ({
            activeApp,
          }));
        },

        setMainView: (view: AppMainView) => {
          set({ mainView: view });
        },

        setWriterSection: (section: WriterSection) => {
          set(() => ({
            writerSection: section,
            mainView: "content",
          }));
        },

        setWriterAppSession: (session: WriterAppSession | null) => {
          set({ writerAppSession: session });
        },

        setWriterSession: (session: WriterUserSession | null) => {
          set({ writerSession: session });
        },

        setWriterLastResolvedUri: (uri: string | null) => {
          set({ writerLastResolvedUri: uri });
        },

        setWriterLastAppUri: (uri: string | null) => {
          set({ writerLastAppUri: uri });
        },

        addWriterOutput: (output: unknown, uri?: string) => {
          set((state) => ({
            writerOutputs: [
              { id: generateId(), data: output, timestamp: Date.now(), uri },
              ...state.writerOutputs,
            ].slice(0, 200),
          }));
        },

        loadEndpoints: async () => {
          const { backends, walletServers, appServers, defaults } = await loadAllEndpoints();
          set((state) => {
            const nextBackends = state.backends.length ? state.backends : backends;
            const nextWallets = state.walletServers.length ? state.walletServers : walletServers;
            const nextApps = state.appServers.length ? state.appServers : appServers;

            const activeBackendId = (() => {
              const existing = nextBackends.find((b) => b.id === state.activeBackendId)?.id;
              if (existing) return existing;
              const defaultBackend = nextBackends.find((b) => b.isActive) ||
                nextBackends.find((b) => b.id === defaults.backend);
              return defaultBackend?.id || nextBackends[0]?.id || null;
            })();

            const activeWalletServerId = (() => {
              const existing = nextWallets.find((w) => w.id === state.activeWalletServerId)?.id;
              if (existing) return existing;
              const defaultWallet = nextWallets.find((w) => w.isActive) ||
                nextWallets.find((w) => w.id === defaults.wallet);
              return defaultWallet?.id || nextWallets[0]?.id || null;
            })();

            const activeAppServerId = (() => {
              const existing = nextApps.find((w) => w.id === state.activeAppServerId)?.id;
              if (existing) return existing;
              const defaultApp = nextApps.find((w) => w.isActive) ||
                nextApps.find((w) => w.id === defaults.appServer);
              return defaultApp?.id || nextApps[0]?.id || null;
            })();

            return {
              backends: nextBackends,
              walletServers: nextWallets,
              appServers: nextApps,
              activeBackendId,
              activeWalletServerId,
              activeAppServerId,
              backendsReady: true,
            };
          });
        },

        addAccount: (account: ManagedAccount) => {
          set((state) => ({
            accounts: [account, ...state.accounts],
            activeAccountId: account.id,
          }));
        },

        removeAccount: (id: string) => {
          set((state) => {
            const nextAccounts = state.accounts.filter((a) => a.id !== id);
            const nextActive = state.activeAccountId === id
              ? nextAccounts[0]?.id || null
              : state.activeAccountId;
            return { accounts: nextAccounts, activeAccountId: nextActive };
          });
        },

        setActiveAccount: (id: string | null) => {
          set({ activeAccountId: id });
        },

        setFormValue: (formId, field, value) => {
          set((state) => ({
            formState: {
              ...state.formState,
              [formId]: { ...(state.formState[formId] || {}), [field]: value },
            },
          }));
        },

        getFormValue: (formId, field, defaultValue = "") => {
          const form = get().formState[formId];
          return form && field in form ? form[field] : defaultValue;
        },

        resetForm: (formId) => {
          set((state) => {
            const next = { ...state.formState };
            delete next[formId];
            return { formState: next };
          });
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

        addLogEntry: (entry) => {
          set((state) => {
            const timestamp = entry.timestamp ?? Date.now();
            const logEntry = { ...entry, timestamp };
            return { logs: [...state.logs, logEntry].slice(-300) };
          });
        },

        clearLogs: () => {
          set({ logs: [] });
        },
      };
    },
    {
      name: "b3nd-rig-state",
      partialize: (state) => {
        // Serialize user-added backends (those not from instances.json)
        const userBackends: SerializableBackendConfig[] = state.backends
          .filter((b) =>
            b.adapter.type === "http" && (b.adapter as any).isUserAdded
          )
          .map((b) => ({
            id: b.id,
            name: b.name,
            type: "http" as const,
            baseUrl: b.adapter.baseUrl || "",
            isActive: b.isActive,
          }));

        return {
          activeBackendId: state.activeBackendId,
          activeApp: state.activeApp,
          writerSection: state.writerSection,
          mainView: state.mainView,
          explorerSection: state.explorerSection,
          explorerIndexPath: state.explorerIndexPath,
          explorerAccountKey: state.explorerAccountKey,
          explorerAccountPath: state.explorerAccountPath,
          formState: state.formState,
          walletServers: state.walletServers,
          activeWalletServerId: state.activeWalletServerId,
          appServers: state.appServers,
          activeAppServerId: state.activeAppServerId,
          googleClientId: state.googleClientId,
          keyBundle: state.keyBundle,
          panels: state.panels,
          bottomMaximized: state.bottomMaximized,
          panelPreferences: state.panelPreferences,
          writerOutputs: state.writerOutputs,
          accounts: state.accounts,
          activeAccountId: state.activeAccountId,
          theme: state.theme,
          searchHistory: state.searchHistory,
          watchedPaths: state.watchedPaths,
          userBackends, // Add user backends to persisted state
        };
      },
      onRehydrateStorage: () => async (state) => {
        console.log("[onRehydrate] Starting rehydration");
        const { backends, walletServers, appServers, defaults } = await loadAllEndpoints();

        if (state) {
          const userBackends: SerializableBackendConfig[] = (state as any).userBackends || [];
          const restoredUserBackends: BackendConfig[] = userBackends.map((b) => ({
            id: b.id,
            name: b.name,
            adapter: Object.assign(new HttpAdapter(b.baseUrl), { isUserAdded: true }),
            isActive: b.isActive,
          }));

          state.backends = [...backends, ...restoredUserBackends];
          const allBackends = [...backends, ...restoredUserBackends];
          const validBackendId = allBackends.find((b) => b.id === state.activeBackendId)?.id;
          const defaultBackend = backends.find((b) => b.isActive) || backends.find((b) => b.id === defaults.backend);
          state.activeBackendId = validBackendId || defaultBackend?.id || allBackends[0]?.id || null;

          const mergedWalletServers = state.walletServers?.length ? state.walletServers : walletServers;
          const validWalletId = mergedWalletServers.find((w) => w.id === state.activeWalletServerId)?.id;
          const defaultWallet = mergedWalletServers.find((w) => w.isActive) ||
            mergedWalletServers.find((w) => w.id === defaults.wallet);
          state.walletServers = mergedWalletServers;
          state.activeWalletServerId = validWalletId || defaultWallet?.id || mergedWalletServers[0]?.id || null;

          const mergedAppServers = state.appServers?.length ? state.appServers : appServers;
          const validAppServerId = mergedAppServers.find((w) => w.id === state.activeAppServerId)?.id;
          const defaultAppServer = mergedAppServers.find((w) => w.isActive) ||
            mergedAppServers.find((w) => w.id === defaults.appServer);
          state.appServers = mergedAppServers;
          state.activeAppServerId = validAppServerId || defaultAppServer?.id || mergedAppServers[0]?.id || null;

          const theme = state.theme || "system";
          const root = document.documentElement;
          if (theme === "dark") root.classList.add("dark");
          else if (theme === "light") root.classList.remove("dark");
          else {
            const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            root.classList.toggle("dark", isDark);
          }

          state.currentPath = "/";
          state.explorerSection = state.explorerSection || "index";
          state.explorerIndexPath = state.explorerIndexPath || "/";
          state.explorerAccountKey = state.explorerAccountKey || null;
          state.explorerAccountPath = state.explorerAccountPath || "/";
          state.navigationHistory = ["/"];
          state.expandedPaths = new Set();
          state.formState = state.formState || {};
          state.searchQuery = "";
          state.searchResults = [];
          state.mode = "filesystem";
          state.activeApp = state.activeApp || "explorer";
          // Migrate old "app" section to "configuration"
          if (state.writerSection === "app" as any) {
            state.writerSection = "configuration";
          }
          state.writerSection = state.writerSection || "backend";
          state.bottomMaximized = state.bottomMaximized || false;
          state.writerAppSession = state.writerAppSession || null;
          state.writerSession = state.writerSession || null;
          state.writerLastResolvedUri = state.writerLastResolvedUri || null;
          state.writerLastAppUri = state.writerLastAppUri || null;
          state.writerOutputs = state.writerOutputs || [];
          state.accounts = state.accounts || [];
          state.activeAccountId = state.activeAccountId || null;
          state.panels = state.panels || { left: true, right: true, bottom: false };
          state.panelPreferences = state.panelPreferences || { right: {} };
          if (state.activeApp === "explorer" && state.writerSection) {
            state.panels.right = true;
          }
          state.mainView = state.mainView || "content";
          state.logs = [];
          state.schemas = {};
          state.rootNodes = [];
          state.walletServers = state.walletServers && state.walletServers.length > 0 ? state.walletServers : walletServers;
          state.appServers = state.appServers && state.appServers.length > 0 ? state.appServers : appServers;
          state.activeWalletServerId =
            state.activeWalletServerId ||
            walletServers.find((w) => w.isActive)?.id ||
            walletServers.find((w) => w.id === defaults.wallet)?.id ||
            walletServers[0]?.id ||
            null;
          state.activeAppServerId =
            state.activeAppServerId ||
            appServers.find((w) => w.isActive)?.id ||
            appServers.find((w) => w.id === defaults.appServer)?.id ||
            appServers[0]?.id ||
            null;
          state.googleClientId = state.googleClientId || "";
          state.keyBundle = state.keyBundle || {
            appKey: "",
            accountPrivateKeyPem: "",
            encryptionPublicKeyHex: "",
            encryptionPrivateKeyPem: "",
          };

          state.backendsReady = true;

          setTimeout(() => {
            const store = useAppStore.getState();
            store.loadSchemas();
          }, 0);
        } else {
          useAppStore.setState({
            backends,
            activeBackendId:
              backends.find((b) => b.isActive)?.id ||
              backends.find((b) => b.id === defaults.backend)?.id ||
              backends[0]?.id ||
              null,
            walletServers,
            activeWalletServerId:
              walletServers.find((w) => w.isActive)?.id ||
              walletServers.find((w) => w.id === defaults.wallet)?.id ||
              walletServers[0]?.id ||
              null,
            appServers,
            activeAppServerId:
              appServers.find((w) => w.isActive)?.id ||
              appServers.find((w) => w.id === defaults.appServer)?.id ||
              appServers[0]?.id ||
              null,
            explorerSection: "index",
            explorerIndexPath: "/",
            explorerAccountKey: null,
            explorerAccountPath: "/",
            backendsReady: true,
          });
        }
      },
    },
  ),
);

export const useActiveBackend = () => {
  const { backends, activeBackendId } = useAppStore();
  return backends.find((b) => b.id === activeBackendId) || null;
};
