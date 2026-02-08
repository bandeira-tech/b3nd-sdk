/**
 * Dashboard types — hybrid live/static architecture
 *
 * Supports both:
 * - Live mode: WebSocket connection to dashboard server for real-time results
 * - Static mode: loads pre-built JSON artifacts from /dashboard/test-results.json
 */

export type TestTheme =
  | "sdk-core"
  | "network"
  | "database"
  | "auth"
  | "binary"
  | "e2e"
  | "browser"
  | "managed-node"
  | "other";

export type BackendType =
  | "memory"
  | "http"
  | "websocket"
  | "postgres"
  | "mongo"
  | "localstorage"
  | "indexeddb"
  | "other";

export type TestStatus = "running" | "passed" | "failed" | "skipped" | "pending";

export type DataSource = "live" | "static" | "b3nd";

export interface TestResult {
  name: string;
  file: string;
  filePath: string;
  theme: TestTheme;
  backend: BackendType;
  status: TestStatus;
  duration?: number;
  lastRun: number;
  source?: string;
  sourceFile?: string;
  sourceStartLine?: number;
  error?: {
    message: string;
    stack?: string;
  };
}

export interface TestRunSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
}

export interface TestFile {
  path: string;
  name: string;
  theme: string;
  backend: string;
  status: string;
  testCount: number;
}

export interface ThemeGroup {
  id: string;
  label: string;
  testCount: number;
}

export interface BackendGroup {
  id: string;
  label: string;
  testCount: number;
}

export interface RunMetadata {
  trigger: string;
  startedAt: number;
  completedAt?: number;
  changedFiles?: string[];
}

export interface ServiceHealth {
  id: string;
  name: string;
  url: string;
  status: "healthy" | "unhealthy" | "unknown";
  latency?: number;
  error?: string;
}

export interface FileChangeEvent {
  kind: "modify" | "create" | "remove";
  files: string[];
  timestamp: number;
}

export interface TestFilter {
  themes?: TestTheme[];
  backends?: BackendType[];
  file?: string;
  pattern?: string;
}

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

// Static artifact format (loaded from /dashboard/test-results.json)
export interface StaticTestData {
  version?: string;
  generatedAt?: number;
  timestamp?: number;
  runId?: string;
  runMetadata?: {
    trigger: string;
    startedAt: number;
    completedAt: number;
    environment: {
      deno: string;
      platform: string;
      hasPostgres: boolean;
      hasMongo: boolean;
    };
  };
  summary: TestRunSummary;
  results: TestResult[];
  files?: TestFile[];
  themes?: ThemeGroup[];
}

// Content modes
export type ContentMode = "results" | "logs";

// Facet system
export type FacetType = "theme" | "backend" | "status" | "keyword";

export interface Facet {
  id: string;
  type: FacetType;
  label: string;
  value: string;
  count?: number;
}

export interface FacetGroup {
  id: string;
  label: string;
  type: FacetType;
  facets: Facet[];
  expanded: boolean;
}

// Store interfaces
export interface DashboardState {
  // Data loading
  loading: boolean;
  error: string | null;
  staticData: StaticTestData | null;

  // Content mode
  contentMode: ContentMode;

  // Test results
  testResults: Map<string, TestResult>;
  runSummary: TestRunSummary | null;

  // Facets
  facetGroups: FacetGroup[];
  activeFacets: Set<string>;
  customKeywords: string[];

  // Inline expansion
  expandedTests: Set<string>;

  // Raw logs (static mode)
  rawLogs: string;

  // WebSocket / live mode
  wsConnected: boolean;
  wsError: string | null;
  isRunning: boolean;
  dataSource: DataSource;
  autoRunEnabled: boolean;

  // B3nd data source — empty means static file mode
  b3ndUrl: string;
  b3ndUri: string;

  // Live data
  services: ServiceHealth[];
  recentChanges: FileChangeEvent[];
  rawOutput: string[];
  showRawOutput: boolean;
  currentRunId: string | null;
  runMetadata: { current: RunMetadata | null; last: RunMetadata | null };
  themes: ThemeGroup[];
  backends: BackendGroup[];
}

export interface DashboardActions {
  // Data loading
  loadStaticData: (data?: StaticTestData) => void | Promise<void>;

  // Content mode
  setContentMode: (mode: ContentMode) => void;

  // Facets
  toggleFacet: (facetId: string) => void;
  clearFacets: () => void;
  addCustomKeyword: (keyword: string) => void;
  removeCustomKeyword: (keyword: string) => void;

  // Inline expansion
  toggleTestExpansion: (testKey: string) => void;
  expandAllFailed: () => void;
  collapseAll: () => void;

  // WebSocket state
  setWsConnected: (connected: boolean) => void;
  setWsError: (error: string | null) => void;

  // Data source
  setDataSource: (source: DataSource) => void;

  // Themes / backends
  setThemes: (themes: ThemeGroup[], backends: BackendGroup[], total: number) => void;

  // Run control
  startRun: (runId: string, filter: TestFilter | null) => void;
  addTestResult: (test: TestResult) => void;
  completeRun: (summary: TestRunSummary) => void;
  cancelRun: () => void;

  // Services
  setServices: (services: ServiceHealth[]) => void;

  // File changes
  addFileChange: (event: FileChangeEvent) => void;

  // Raw output
  addRawOutput: (line: string) => void;
  setShowRawOutput: (show: boolean) => void;

  // Initial state from server
  loadInitialState: (data: { results: TestResult[]; runMetadata: { current: RunMetadata | null; last: RunMetadata | null } }) => void;
  setRunMetadata: (metadata: { current: RunMetadata | null; last: RunMetadata | null }) => void;

  // B3nd settings
  setB3ndUrl: (url: string) => void;
  setB3ndUri: (uri: string) => void;
}
