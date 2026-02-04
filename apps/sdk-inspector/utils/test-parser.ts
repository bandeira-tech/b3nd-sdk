/**
 * Parse Deno test JSON reporter output
 * Deno test --json outputs JSON lines with different event types
 */

export interface TestStartEvent {
  type: "testStart";
  test: {
    name: string;
    origin: string; // file path
  };
}

export interface TestEndEvent {
  type: "testEnd";
  test: {
    name: string;
    origin: string;
    result: "ok" | "failed" | "ignored";
    duration: number;
  };
  error?: {
    message: string;
    stack?: string;
  };
}

export interface TestPlanEvent {
  type: "testPlan";
  plan: {
    origin: string;
    tests: number;
  };
}

export interface TestSummaryEvent {
  type: "testSummary";
  summary: {
    passed: number;
    failed: number;
    ignored: number;
    duration: number;
  };
}

export type TestEvent =
  | TestStartEvent
  | TestEndEvent
  | TestPlanEvent
  | TestSummaryEvent
  | { type: string; [key: string]: unknown };

/**
 * Parse a single line of Deno test JSON output
 */
export function parseTestLine(line: string): TestEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as TestEvent;
  } catch {
    return null;
  }
}

/**
 * Test theme classification based on file path
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

/**
 * Backend type for filtering by storage/transport backend
 */
export type BackendType =
  | "memory"
  | "http"
  | "websocket"
  | "postgres"
  | "mongo"
  | "localstorage"
  | "indexeddb"
  | "other";

export interface BackendInfo {
  id: BackendType;
  label: string;
  pattern: RegExp;
  theme: TestTheme;
}

/**
 * Backend classifications - storage and transport backends only
 */
export const BACKEND_TYPES: BackendInfo[] = [
  { id: "memory", label: "Memory", pattern: /memory-client/, theme: "sdk-core" },
  { id: "http", label: "HTTP", pattern: /http-client/, theme: "network" },
  { id: "websocket", label: "WebSocket", pattern: /websocket-client/, theme: "network" },
  { id: "postgres", label: "PostgreSQL", pattern: /postgres/, theme: "database" },
  { id: "mongo", label: "MongoDB", pattern: /mongo/, theme: "database" },
  { id: "localstorage", label: "LocalStorage", pattern: /local-storage/, theme: "browser" },
  { id: "indexeddb", label: "IndexedDB", pattern: /indexed-db/, theme: "browser" },
];

export interface ThemeInfo {
  id: TestTheme;
  label: string;
  description: string;
  patterns: RegExp[];
}

export const TEST_THEMES: ThemeInfo[] = [
  {
    id: "sdk-core",
    label: "SDK Core",
    description: "Fundamental B3nd operations - memory client, transactions, multi-read",
    patterns: [/memory-client/, /txn\.test/, /read-multi/],
  },
  {
    id: "network",
    label: "Network",
    description: "HTTP and WebSocket client protocols",
    patterns: [/http-client/, /websocket-client/],
  },
  {
    id: "database",
    label: "Database",
    description: "PostgreSQL and MongoDB persistence backends",
    patterns: [/postgres/, /mongo/],
  },
  {
    id: "auth",
    label: "Auth",
    description: "Authentication, wallet, and encryption",
    patterns: [/auth/, /wallet/, /encrypt/],
  },
  {
    id: "binary",
    label: "Binary",
    description: "Blob and binary data handling",
    patterns: [/binary/, /blob/],
  },
  {
    id: "e2e",
    label: "E2E",
    description: "End-to-end integration tests",
    patterns: [/e2e/, /integ/, /\/tests\//],
  },
  {
    id: "browser",
    label: "Browser",
    description: "Browser-specific client tests (localStorage, IndexedDB)",
    patterns: [/browser/, /local-storage/, /indexed-db/],
  },
];

/**
 * Classify a test file into a theme based on its path
 */
export function classifyTestTheme(filePath: string): TestTheme {
  const normalized = filePath.toLowerCase();

  for (const theme of TEST_THEMES) {
    for (const pattern of theme.patterns) {
      if (pattern.test(normalized)) {
        return theme.id;
      }
    }
  }

  return "other";
}

/**
 * Classify a test file into a backend type
 */
export function classifyBackendType(filePath: string): BackendType {
  const normalized = filePath.toLowerCase();

  for (const backend of BACKEND_TYPES) {
    if (backend.pattern.test(normalized)) {
      return backend.id;
    }
  }

  return "other";
}

/**
 * Get backend info by ID
 */
export function getBackendInfo(backendId: BackendType): BackendInfo | undefined {
  return BACKEND_TYPES.find((b) => b.id === backendId);
}

/**
 * Get theme info by ID
 */
export function getThemeInfo(themeId: TestTheme): ThemeInfo | undefined {
  return TEST_THEMES.find((t) => t.id === themeId);
}

/**
 * Extract the relative test path from an origin URL or path
 */
export function extractTestPath(origin: string): string {
  // Handle file:// URLs
  if (origin.startsWith("file://")) {
    const url = new URL(origin);
    return url.pathname;
  }
  return origin;
}

/**
 * Get the test file name from a path
 */
export function getTestFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}
