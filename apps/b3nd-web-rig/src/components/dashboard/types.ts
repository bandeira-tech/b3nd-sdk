/**
 * Dashboard types — reads test data from B3nd or static files
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

export type DataSource = "b3nd" | "static";

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

// Static artifact format (loaded from B3nd or /dashboard/test-results.json)
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

  // Raw logs
  rawLogs: string;

  // Data source
  dataSource: DataSource;

  // B3nd data URI — empty means static file mode
  // The node URL comes from the active backend in appStore
  b3ndUri: string;
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

  // B3nd URI
  setB3ndUri: (uri: string) => void;
}
