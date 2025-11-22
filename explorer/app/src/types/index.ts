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

// Application state types
export type AppMode = "filesystem" | "search" | "watched";
export type AppExperience = "explorer" | "writer";
export type WriterSection = "config" | "backend" | "app" | "auth";

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

export interface AppState {
  // Backend management
  backends: BackendConfig[];
  activeBackendId: string | null;

  // Schema and root navigation
  schemas: Record<string, string[]>; // Schemas by instance: { instanceId: [uris] }
  rootNodes: NavigationNode[]; // Virtual root nodes built from schemas

  // Navigation
  currentPath: string;
  navigationHistory: string[];
  expandedPaths: Set<string>;

  // UI state
  panels: PanelState;
  theme: ThemeMode;
  mode: AppMode;
  activeApp: AppExperience;
  writerSection: WriterSection;

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

  // Schema actions
  loadSchemas: () => Promise<void>;

  // Navigation actions
  navigateToPath: (path: string) => void;
  togglePathExpansion: (path: string) => void;
  goBack: () => void;
  goForward: () => void;

  // UI actions
  togglePanel: (panel: keyof PanelState) => void;
  setTheme: (theme: ThemeMode) => void;
  setMode: (mode: AppMode) => void;
  setActiveApp: (app: AppExperience) => void;
  setWriterSection: (section: WriterSection) => void;

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
