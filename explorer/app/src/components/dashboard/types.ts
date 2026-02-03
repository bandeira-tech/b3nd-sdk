/**
 * Dashboard types for the B3nd Developer Dashboard
 */

export type TestTheme =
  | "sdk-core"
  | "network"
  | "database"
  | "auth"
  | "binary"
  | "e2e"
  | "browser"
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

export interface TestResult {
  name: string;
  file: string;
  filePath: string;
  theme: TestTheme;
  backend: BackendType;
  status: TestStatus;
  duration?: number;
  lastRun: number;
  error?: {
    message: string;
    stack?: string;
  };
}

export type RunTrigger = "startup" | "file-change" | "manual";

export interface RunMetadata {
  trigger: RunTrigger;
  startedAt: number;
  completedAt?: number;
  changedFiles?: string[];
}

export interface TestFile {
  path: string;
  name: string;
  backend: BackendType;
}

export interface ThemeGroup {
  id: TestTheme;
  label: string;
  description: string;
  testCount: number;
  files: TestFile[];
}

export interface BackendGroup {
  id: BackendType;
  label: string;
  theme: TestTheme;
  testCount: number;
  files: TestFile[];
}

export interface TestRunSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
}

export interface ServiceHealth {
  id: string;
  name: string;
  url: string;
  status: "healthy" | "unhealthy" | "unknown";
  latency?: number;
  lastChecked: number;
  error?: string;
}

export interface FileChangeEvent {
  kind: "create" | "modify" | "remove" | "access" | "any" | "other";
  files: string[];
  timestamp: number;
}

// WebSocket message types
export type WsMessageType =
  | "connected"
  | "test:start"
  | "test:result"
  | "test:plan"
  | "test:complete"
  | "test:cancelled"
  | "test:error"
  | "health:update"
  | "file:change"
  | "state:update"
  | "run:start"
  | "run:complete"
  | "run:error"
  | "pong";

export interface WsMessage {
  type: WsMessageType;
  timestamp?: number;
  [key: string]: unknown;
}

export interface TestFilter {
  themes?: TestTheme[];
  backends?: BackendType[];
  file?: string;
  pattern?: string;
}

// Facet system types
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

// Data source types
export type DataSourceType = "live" | "static";

export interface DataSource {
  type: DataSourceType;
  label: string;
  description: string;
}

export interface StaticTestData {
  timestamp: number;
  runId: string;
  summary: TestRunSummary;
  results: TestResult[];
  themes: ThemeGroup[];
}

// Left panel view modes
export type LeftPanelView = "tests" | "logs" | "code";

// Source file content
export interface SourceFile {
  file: string;
  relativePath: string;
  content: string;
  lineCount: number;
}

// Dashboard UI state
export interface DashboardState {
  // Connection
  wsConnected: boolean;
  wsError: string | null;

  // Data source
  dataSource: DataSourceType;
  staticData: StaticTestData | null;

  // Test discovery
  themes: ThemeGroup[];
  backends: BackendGroup[];
  totalTests: number;

  // Facets
  facetGroups: FacetGroup[];
  activeFacets: Set<string>; // Set of facet IDs
  customKeywords: string[];

  // Test run
  isRunning: boolean;
  currentRunId: string | null;
  testResults: Map<string, TestResult>;
  runSummary: TestRunSummary | null;
  runMetadata: { current: RunMetadata | null; last: RunMetadata | null };

  // Health
  services: ServiceHealth[];

  // File changes
  recentChanges: FileChangeEvent[];
  autoRunEnabled: boolean;

  // UI
  showRawOutput: boolean;
  rawOutput: string[];

  // Navigation
  activeView: LeftPanelView;
  selectedSourceFile: string | null;
  sourceContent: SourceFile | null;
  sourceLoading: boolean;
  logLines: string[];
  logLoading: boolean;
  highlightedTestName: string | null;
}

export interface DashboardActions {
  // Connection
  setWsConnected: (connected: boolean) => void;
  setWsError: (error: string | null) => void;

  // Data source
  setDataSource: (source: DataSourceType) => void;
  loadStaticData: (data: StaticTestData) => void;

  // Test discovery
  setThemes: (themes: ThemeGroup[], backends: BackendGroup[], totalTests: number) => void;

  // Facets
  setFacetGroups: (groups: FacetGroup[]) => void;
  toggleFacet: (facetId: string) => void;
  clearFacets: () => void;
  addCustomKeyword: (keyword: string) => void;
  removeCustomKeyword: (keyword: string) => void;

  // Test run
  startRun: (runId: string, filter: TestFilter | null) => void;
  addTestResult: (result: TestResult) => void;
  completeRun: (summary: TestRunSummary) => void;
  cancelRun: () => void;
  clearResults: () => void;
  setRunMetadata: (metadata: { current: RunMetadata | null; last: RunMetadata | null }) => void;
  loadInitialState: (state: { results: TestResult[]; runMetadata: { current: RunMetadata | null; last: RunMetadata | null } }) => void;

  // Health
  setServices: (services: ServiceHealth[]) => void;

  // File changes
  addFileChange: (event: FileChangeEvent) => void;
  setAutoRunEnabled: (enabled: boolean) => void;

  // UI
  setShowRawOutput: (show: boolean) => void;
  addRawOutput: (line: string) => void;
  clearRawOutput: () => void;

  // Navigation
  setActiveView: (view: LeftPanelView) => void;
  setSelectedSourceFile: (file: string | null) => void;
  setSourceContent: (content: SourceFile | null) => void;
  setSourceLoading: (loading: boolean) => void;
  setLogLines: (lines: string[]) => void;
  setLogLoading: (loading: boolean) => void;
  setHighlightedTestName: (name: string | null) => void;
  navigateToSource: (filePath: string, testName?: string) => void;
}
