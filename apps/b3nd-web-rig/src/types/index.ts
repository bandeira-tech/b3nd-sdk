// Core persistence types mirroring b3nd/persistence
export interface PersistenceRecord<T = any> {
  ts: number;
  data: T;
}

// Navigation and UI types
export interface NavigationNode {
  path: string; // Primary identifier (e.g., "/users/alice/profile")
  name: string; // Display name (last segment of path)
  type: "directory" | "file";
  children?: NavigationNode[]; // Lazy-loaded via listPath
  // Optional record metadata when a file node includes it (e.g., mock data)
  record?: PersistenceRecord;
}

export interface SearchResult {
  path: string;
  name: string;
  record: PersistenceRecord;
  snippet?: string;
}

export type ExplorerSection = "index" | "account";

export interface SearchFilters {
  protocol?: string;
  domain?: string;
  pathPattern?: string;
  dataType?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
  };
}

// Backend adapter interface
export interface BackendAdapter {
  name: string;
  type: "mock" | "http";
  baseUrl?: string;

  // Core operations
  listPath(
    path: string,
    options?: { page?: number; limit?: number },
  ): Promise<PaginatedResponse<NavigationNode>>;
  readRecord(path: string): Promise<PersistenceRecord>;
  searchPaths(
    query: string,
    filters?: SearchFilters,
    options?: { page?: number; limit?: number },
  ): Promise<PaginatedResponse<SearchResult>>;

  // Metadata
  getSchema(): Promise<Record<string, string[]>>; // Schemas keyed by backend (single entry)
  healthCheck(): Promise<boolean>;
}

export interface BackendConfig {
  id: string;
  name: string;
  adapter: BackendAdapter;
  isActive: boolean;
}

export interface EndpointConfig {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
}

// Application state types
export type AppMode = "filesystem" | "search" | "watched";
export type AppExperience = "explorer" | "writer" | "dashboard" | "nodes";
export type WriterSection =
  | "backend"
  | "blob"
  | "auth"
  | "actions"
  | "configuration"
  | "schema"
  | "shareable";
export type AppMainView = "content" | "settings" | "accounts";

export type ThemeMode = "light" | "dark" | "system";

export interface PanelState {
  left: boolean;
  right: boolean;
  bottom: boolean;
}

export interface AppLogEntry {
  timestamp: number;
  source: string;
  message: string;
  level?: "info" | "success" | "warning" | "error";
}

export interface KeyBundle {
  appKey: string;
  accountPrivateKeyPem: string;
  encryptionPublicKeyHex: string;
  encryptionPrivateKeyPem: string;
}

export type ManagedAccountType = "account" | "application" | "application-user";

export interface AccountAuthKeys {
  accountPublicKeyHex: string;
  encryptionPublicKeyHex: string;
}

interface BaseManagedAccount {
  id: string;
  name: string;
  createdAt: number;
  emoji: string;
}

export interface ManagedKeyAccount extends BaseManagedAccount {
  type: "account" | "application";
  keyBundle: KeyBundle;
}

export interface ManagedApplicationUserAccount extends BaseManagedAccount {
  type: "application-user";
  appAccountId: string;
  appName: string;
  appKey: string;
  appSession: string;
  userSession: WriterUserSession;
  authKeys: AccountAuthKeys;
  googleClientId: string | null;
}

export type ManagedAccount = ManagedKeyAccount | ManagedApplicationUserAccount;

export interface WriterUserSession {
  username: string;
  token: string;
  expiresIn: number;
}

/**
 * Session keypair for wallet authentication.
 * This must be generated and approved before login/signup.
 */
export interface WriterSessionKeypair {
  publicKeyHex: string;
  privateKeyHex: string;
}

/**
 * App session state including the session ID and keypair for authentication.
 */
export interface WriterAppSession {
  sessionId: string;
  sessionKeypair: WriterSessionKeypair;
}

export interface AppState {
  // Backend management
  backends: BackendConfig[];
  activeBackendId: string | null;

  walletServers: EndpointConfig[];
  activeWalletServerId: string | null;

  appServers: EndpointConfig[];
  activeAppServerId: string | null;
  googleClientId: string;
  keyBundle: KeyBundle;

  // Schema and root navigation
  schemas: Record<string, string[]>; // Schemas by instance: { instanceId: [uris] }
  rootNodes: NavigationNode[]; // Virtual root nodes built from schemas

  // Navigation
  currentPath: string;
  explorerSection: ExplorerSection;
  explorerIndexPath: string;
  explorerAccountKey: string | null;
  explorerAccountPath: string;
  navigationHistory: string[];
  expandedPaths: Set<string>;

  // UI state
  panels: PanelState;
  bottomMaximized: boolean;
  theme: ThemeMode;
  mode: AppMode;
  activeApp: AppExperience;
  mainView: AppMainView;
  writerSection: WriterSection;
  writerAppSession: WriterAppSession | null;
  writerSession: WriterUserSession | null;
  writerLastResolvedUri: string | null;
  writerLastAppUri: string | null;
  writerOutputs: Array<{
    id: string;
    data: unknown;
    timestamp: number;
    uri?: string;
  }>;
  accounts: ManagedAccount[];
  activeAccountId: string | null;

  formState: Record<string, Record<string, string>>;

  // Search
  searchQuery: string;
  searchHistory: string[];
  searchResults: SearchResult[];

  // Watched paths
  watchedPaths: string[];

  // Logs
  logs: AppLogEntry[];
}

// Action types for state management
export interface AppActions {
  // Backend actions
  addBackend: (config: Omit<BackendConfig, "id">) => void;
  removeBackend: (id: string) => void;
  setActiveBackend: (id: string) => void;
  loadEndpoints: () => Promise<void>;
  addWalletServer: (config: Omit<EndpointConfig, "id">) => void;
  removeWalletServer: (id: string) => void;
  setActiveWalletServer: (id: string) => void;
  addAppServer: (config: Omit<EndpointConfig, "id">) => void;
  removeAppServer: (id: string) => void;
  setActiveAppServer: (id: string) => void;
  setGoogleClientId: (id: string) => void;
  setKeyBundle: (bundle: Partial<KeyBundle>) => void;
  closeSettings: () => void;

  // Schema actions
  loadSchemas: () => Promise<void>;

  // Navigation actions
  navigateToPath: (
    path: string,
    options?: { section?: ExplorerSection; accountKey?: string | null },
  ) => void;
  setExplorerSection: (section: ExplorerSection) => void;
  setExplorerIndexPath: (path: string) => void;
  setExplorerAccountKey: (accountKey: string | null) => void;
  setExplorerAccountPath: (path: string) => void;
  togglePathExpansion: (path: string) => void;
  goBack: () => void;
  goForward: () => void;

  // UI actions
  togglePanel: (panel: keyof PanelState) => void;
  setPanelOpen: (panel: keyof PanelState, open: boolean) => void;
  toggleBottomPanelMaximized: () => void;
  ensureRightPanelOpen: () => void;
  applyRightPanelPreference: () => void;
  setTheme: (theme: ThemeMode) => void;
  setMode: (mode: AppMode) => void;
  setActiveApp: (app: AppExperience) => void;
  setMainView: (view: AppMainView) => void;
  setWriterSection: (section: WriterSection) => void;
  setWriterAppSession: (session: WriterAppSession | null) => void;
  setWriterSession: (session: WriterUserSession | null) => void;
  setWriterLastResolvedUri: (uri: string | null) => void;
  setWriterLastAppUri: (uri: string | null) => void;
  addWriterOutput: (output: unknown, uri?: string) => void;
  addAccount: (account: ManagedAccount) => void;
  removeAccount: (id: string) => void;
  setActiveAccount: (id: string | null) => void;

  setFormValue: (formId: string, field: string, value: string) => void;
  getFormValue: (formId: string, field: string, defaultValue?: string) => string;
  resetForm: (formId: string) => void;

  // Search actions
  setSearchQuery: (query: string) => void;
  addToSearchHistory: (query: string) => void;
  clearSearchResults: () => void;

  // Watched paths actions
  addWatchedPath: (path: string) => void;
  removeWatchedPath: (path: string) => void;

  // Logs
  addLogEntry: (entry: Omit<AppLogEntry, "timestamp"> & { timestamp?: number }) => void;
  clearLogs: () => void;
}
