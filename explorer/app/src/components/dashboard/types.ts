/**
 * Dashboard types — static-first architecture
 *
 * The dashboard loads pre-built JSON artifacts from /dashboard/test-results.json
 * No WebSocket or live server dependency in production.
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

// Static artifact format (loaded from /dashboard/test-results.json)
export interface StaticTestData {
  version: string;
  generatedAt: number;
  runMetadata: {
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
  files: TestFile[];
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
}

export interface DashboardActions {
  // Data loading
  loadStaticData: () => Promise<void>;

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
}
