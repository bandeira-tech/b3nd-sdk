import { create } from "zustand";
import type {
  DashboardState,
  DashboardActions,
  TestResult,
  TestRunSummary,
  FacetGroup,
  ContentMode,
  StaticTestData,
  DataSource,
  ServiceHealth,
  FileChangeEvent,
  ThemeGroup,
  BackendGroup,
  TestFilter,
  RunMetadata,
} from "../types";

// Default facet groups
const DEFAULT_STATUS_FACETS: FacetGroup = {
  id: "status",
  label: "Status",
  type: "status",
  expanded: true,
  facets: [
    { id: "status:passed", type: "status", label: "Passed", value: "passed" },
    { id: "status:failed", type: "status", label: "Failed", value: "failed" },
    { id: "status:skipped", type: "status", label: "Skipped", value: "skipped" },
  ],
};

const DEFAULT_THEME_FACETS: FacetGroup = {
  id: "themes",
  label: "Themes",
  type: "theme",
  expanded: true,
  facets: [
    { id: "theme:sdk-core", type: "theme", label: "SDK Core", value: "sdk-core" },
    { id: "theme:network", type: "theme", label: "Network", value: "network" },
    { id: "theme:database", type: "theme", label: "Database", value: "database" },
    { id: "theme:auth", type: "theme", label: "Auth", value: "auth" },
    { id: "theme:binary", type: "theme", label: "Binary", value: "binary" },
    { id: "theme:e2e", type: "theme", label: "E2E", value: "e2e" },
    { id: "theme:browser", type: "theme", label: "Browser", value: "browser" },
  ],
};

const DEFAULT_BACKEND_FACETS: FacetGroup = {
  id: "backends",
  label: "Backends",
  type: "backend",
  expanded: true,
  facets: [
    { id: "backend:memory", type: "backend", label: "Memory", value: "memory" },
    { id: "backend:http", type: "backend", label: "HTTP", value: "http" },
    { id: "backend:postgres", type: "backend", label: "PostgreSQL", value: "postgres" },
    { id: "backend:mongo", type: "backend", label: "MongoDB", value: "mongo" },
  ],
};

const MAX_RAW_OUTPUT_LINES = 500;
const MAX_RECENT_CHANGES = 20;

// Load saved settings from localStorage
function loadSavedSettings() {
  try {
    return {
      b3ndUrl: localStorage.getItem("dashboard:b3ndUrl") || "http://localhost:9900",
      inspectorBasePath: localStorage.getItem("dashboard:inspectorBasePath") || "main",
      inspectorPort: Number(localStorage.getItem("dashboard:inspectorPort") || "5556"),
    };
  } catch {
    return { b3ndUrl: "http://localhost:9900", inspectorBasePath: "main", inspectorPort: 5556 };
  }
}

const saved = loadSavedSettings();

const initialState: DashboardState = {
  loading: false,
  error: null,
  staticData: null,
  contentMode: "results",
  testResults: new Map(),
  runSummary: null,
  facetGroups: [DEFAULT_STATUS_FACETS, DEFAULT_THEME_FACETS, DEFAULT_BACKEND_FACETS],
  activeFacets: new Set(),
  customKeywords: [],
  expandedTests: new Set(),
  rawLogs: "",

  // WebSocket / live mode
  wsConnected: false,
  wsError: null,
  isRunning: false,
  dataSource: "b3nd",
  autoRunEnabled: true,

  // B3nd connection settings
  b3ndUrl: saved.b3ndUrl,
  inspectorBasePath: saved.inspectorBasePath,
  inspectorPort: saved.inspectorPort,
  availableBasePaths: [],

  // Live data
  services: [],
  recentChanges: [],
  rawOutput: [],
  showRawOutput: false,
  currentRunId: null,
  runMetadata: { current: null, last: null },
  themes: [],
  backends: [],
};

export interface DashboardStore extends DashboardState, DashboardActions {}

/** Default facet definitions keyed by group id, used to rebuild on each update */
const DEFAULT_FACETS_BY_GROUP: Record<string, FacetGroup> = {
  status: DEFAULT_STATUS_FACETS,
  themes: DEFAULT_THEME_FACETS,
  backends: DEFAULT_BACKEND_FACETS,
};

/**
 * Populate facet counts from test results.
 * Always rebuilds from defaults so facets can't be permanently lost.
 */
function updateFacetCounts(
  groups: FacetGroup[],
  results: TestResult[]
): FacetGroup[] {
  const statusCounts: Record<string, number> = {};
  const themeCounts: Record<string, number> = {};
  const backendCounts: Record<string, number> = {};

  for (const r of results) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    themeCounts[r.theme] = (themeCounts[r.theme] || 0) + 1;
    backendCounts[r.backend] = (backendCounts[r.backend] || 0) + 1;
  }

  return groups.map((group) => {
    const countsMap =
      group.type === "status"
        ? statusCounts
        : group.type === "theme"
          ? themeCounts
          : group.type === "backend"
            ? backendCounts
            : {};

    // Start from default facets for known groups to restore any that were lost
    const defaults = DEFAULT_FACETS_BY_GROUP[group.id];
    const baseFacets = defaults ? defaults.facets : group.facets;

    // Merge: keep any custom facets (keywords) that aren't in defaults
    const defaultIds = new Set(baseFacets.map((f) => f.id));
    const customFacets = group.facets.filter((f) => !defaultIds.has(f.id));
    const allFacets = [...baseFacets, ...customFacets];

    return {
      ...group,
      facets: allFacets
        .map((f) => ({ ...f, count: countsMap[f.value] || 0 }))
        .filter((f) => f.count > 0 || group.type === "status"),
    };
  });
}

/**
 * Load data into the store's format
 */
function loadData(results: TestResult[]) {
  const resultsMap = new Map<string, TestResult>();
  for (const result of results) {
    const key = `${result.file}::${result.name}`;
    resultsMap.set(key, result);
  }

  // Auto-expand failed tests
  const expanded = new Set<string>();
  for (const [key, result] of resultsMap) {
    if (result.status === "failed") {
      expanded.add(key);
    }
  }

  return { resultsMap, expanded };
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  ...initialState,

  // --- Data loading ---

  loadStaticData: async (data?: StaticTestData) => {
    if (data) {
      // Direct data loading (from file picker or export)
      const { resultsMap, expanded } = loadData(data.results);
      const results = Array.from(resultsMap.values());
      const updatedGroups = updateFacetCounts(get().facetGroups, results);

      set({
        loading: false,
        staticData: data,
        testResults: resultsMap,
        runSummary: data.summary,
        facetGroups: updatedGroups,
        expandedTests: expanded,
        dataSource: "static",
      });
      return;
    }

    set({ loading: true, error: null });

    const { b3ndUrl, inspectorBasePath } = get();

    // Try B3nd first
    try {
      const uri = `mutable://open/inspector/${inspectorBasePath}/results`;
      const b3ndReadUrl = `${b3ndUrl}/api/v1/read/mutable/open/inspector/${inspectorBasePath}/results`;
      const res = await fetch(b3ndReadUrl);

      if (res.ok) {
        const record = await res.json();
        // B3nd returns { data, ts } — the artifact is in data
        const staticData: StaticTestData = record.data ?? record;

        let rawLogs = "";
        try {
          const logsUrl = `${b3ndUrl}/api/v1/read/mutable/open/inspector/${inspectorBasePath}/logs`;
          const logsRes = await fetch(logsUrl);
          if (logsRes.ok) {
            const logsRecord = await logsRes.json();
            const logsData = logsRecord.data ?? logsRecord;
            rawLogs = Array.isArray(logsData.lines)
              ? logsData.lines.join("\n")
              : typeof logsData === "string" ? logsData : "";
          }
        } catch {
          // Logs are optional
        }

        const { resultsMap, expanded } = loadData(staticData.results);
        const results = Array.from(resultsMap.values());
        const updatedGroups = updateFacetCounts(get().facetGroups, results);

        set({
          loading: false,
          staticData,
          testResults: resultsMap,
          runSummary: staticData.summary,
          facetGroups: updatedGroups,
          expandedTests: expanded,
          rawLogs,
          dataSource: "b3nd",
        });
        return;
      }
    } catch {
      // B3nd unavailable, fall through to static file
    }

    // Fallback: fetch from static JSON files
    try {
      const resultsRes = await fetch("/dashboard/test-results.json");
      if (!resultsRes.ok) throw new Error(`Failed to load test results: ${resultsRes.status}`);
      const staticData: StaticTestData = await resultsRes.json();

      let rawLogs = "";
      try {
        const logsRes = await fetch("/dashboard/test-logs.txt");
        if (logsRes.ok) rawLogs = await logsRes.text();
      } catch {
        // Logs are optional
      }

      const { resultsMap, expanded } = loadData(staticData.results);
      const results = Array.from(resultsMap.values());
      const updatedGroups = updateFacetCounts(get().facetGroups, results);

      set({
        loading: false,
        staticData,
        testResults: resultsMap,
        runSummary: staticData.summary,
        facetGroups: updatedGroups,
        expandedTests: expanded,
        rawLogs,
        dataSource: "static",
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  setContentMode: (mode: ContentMode) => {
    set({ contentMode: mode });
  },

  // --- WebSocket state ---

  setWsConnected: (connected: boolean) => {
    set({ wsConnected: connected });
  },

  setWsError: (error: string | null) => {
    set({ wsError: error });
  },

  // --- Data source ---

  setDataSource: (source: DataSource) => {
    set({ dataSource: source });
  },

  // --- Themes / backends ---

  setThemes: (_themes: ThemeGroup[], _backends: BackendGroup[], _total: number) => {
    set({ themes: _themes, backends: _backends });
  },

  // --- Run control ---

  startRun: (runId: string, _filter: TestFilter | null) => {
    set({
      isRunning: true,
      currentRunId: runId,
      runMetadata: {
        current: {
          trigger: "manual",
          startedAt: Date.now(),
        },
        last: get().runMetadata.last,
      },
    });
  },

  addTestResult: (test: TestResult) => {
    set((state) => {
      const key = `${test.file}::${test.name}`;
      const newResults = new Map(state.testResults);
      const prev = newResults.get(key);
      // Preserve source fields from static data when live results arrive without them
      const merged = { ...test, lastRun: Date.now() };
      if (prev?.source && !merged.source) {
        merged.source = prev.source;
        merged.sourceFile = prev.sourceFile;
        merged.sourceStartLine = prev.sourceStartLine;
      }
      newResults.set(key, merged);

      const results = Array.from(newResults.values());
      const updatedGroups = updateFacetCounts(state.facetGroups, results);

      // Auto-expand failed tests
      const newExpanded = new Set(state.expandedTests);
      if (test.status === "failed") {
        newExpanded.add(key);
      }

      return {
        testResults: newResults,
        facetGroups: updatedGroups,
        expandedTests: newExpanded,
      };
    });
  },

  completeRun: (summary: TestRunSummary) => {
    set((state) => ({
      isRunning: false,
      runSummary: summary,
      runMetadata: {
        current: null,
        last: {
          trigger: state.runMetadata.current?.trigger || "unknown",
          startedAt: state.runMetadata.current?.startedAt || Date.now(),
          completedAt: Date.now(),
          changedFiles: state.runMetadata.current?.changedFiles,
        },
      },
    }));
  },

  cancelRun: () => {
    set((state) => ({
      isRunning: false,
      currentRunId: null,
      runMetadata: {
        current: null,
        last: state.runMetadata.last,
      },
    }));
  },

  // --- Services ---

  setServices: (services: ServiceHealth[]) => {
    set({ services });
  },

  // --- File changes ---

  addFileChange: (event: FileChangeEvent) => {
    set((state) => ({
      recentChanges: [event, ...state.recentChanges].slice(0, MAX_RECENT_CHANGES),
    }));
  },

  // --- Raw output ---

  addRawOutput: (line: string) => {
    set((state) => ({
      rawOutput: [...state.rawOutput, line].slice(-MAX_RAW_OUTPUT_LINES),
    }));
  },

  setShowRawOutput: (show: boolean) => {
    set({ showRawOutput: show });
  },

  // --- Initial state from server ---

  loadInitialState: (data: { results: TestResult[]; runMetadata: { current: RunMetadata | null; last: RunMetadata | null } }) => {
    const existing = get().testResults;
    const { resultsMap, expanded } = loadData(data.results);

    // Preserve source fields from existing results (loaded from static file)
    for (const [key, result] of resultsMap) {
      const prev = existing.get(key);
      if (prev?.source && !result.source) {
        result.source = prev.source;
        result.sourceFile = prev.sourceFile;
        result.sourceStartLine = prev.sourceStartLine;
      }
    }

    const results = Array.from(resultsMap.values());
    const updatedGroups = updateFacetCounts(get().facetGroups, results);

    const passed = results.filter((r) => r.status === "passed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    set({
      testResults: resultsMap,
      facetGroups: updatedGroups,
      expandedTests: expanded,
      runMetadata: data.runMetadata,
      isRunning: data.runMetadata.current !== null,
      runSummary: {
        passed,
        failed,
        skipped,
        total: results.length,
        duration: 0,
      },
    });
  },

  setRunMetadata: (metadata: { current: RunMetadata | null; last: RunMetadata | null }) => {
    set({
      runMetadata: metadata,
      isRunning: metadata.current !== null,
    });
  },

  // --- Facets ---

  toggleFacet: (facetId: string) => {
    set((state) => {
      const newActive = new Set(state.activeFacets);
      if (newActive.has(facetId)) {
        newActive.delete(facetId);
      } else {
        newActive.add(facetId);
      }
      return { activeFacets: newActive };
    });
  },

  clearFacets: () => {
    set({ activeFacets: new Set(), customKeywords: [] });
  },

  addCustomKeyword: (keyword: string) => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return;

    set((state) => {
      if (state.customKeywords.includes(trimmed)) return state;

      const newKeywords = [...state.customKeywords, trimmed];
      const keywordGroup = state.facetGroups.find((g) => g.id === "keywords");

      let updatedGroups: FacetGroup[];
      if (keywordGroup) {
        updatedGroups = state.facetGroups.map((g) => {
          if (g.id === "keywords") {
            return {
              ...g,
              facets: [
                ...g.facets,
                { id: `keyword:${trimmed}`, type: "keyword" as const, label: trimmed, value: trimmed },
              ],
            };
          }
          return g;
        });
      } else {
        updatedGroups = [
          {
            id: "keywords",
            label: "Keywords",
            type: "keyword" as const,
            expanded: true,
            facets: [{ id: `keyword:${trimmed}`, type: "keyword" as const, label: trimmed, value: trimmed }],
          },
          ...state.facetGroups,
        ];
      }

      const newActive = new Set(state.activeFacets);
      newActive.add(`keyword:${trimmed}`);

      return {
        customKeywords: newKeywords,
        facetGroups: updatedGroups,
        activeFacets: newActive,
      };
    });
  },

  removeCustomKeyword: (keyword: string) => {
    set((state) => {
      const newKeywords = state.customKeywords.filter((k) => k !== keyword);
      const facetId = `keyword:${keyword}`;

      const updatedGroups = state.facetGroups
        .map((g) => {
          if (g.id === "keywords") {
            return { ...g, facets: g.facets.filter((f) => f.id !== facetId) };
          }
          return g;
        })
        .filter((g) => g.id !== "keywords" || g.facets.length > 0);

      const newActive = new Set(state.activeFacets);
      newActive.delete(facetId);

      return {
        customKeywords: newKeywords,
        facetGroups: updatedGroups,
        activeFacets: newActive,
      };
    });
  },

  // --- Inline expansion ---

  toggleTestExpansion: (testKey: string) => {
    set((state) => {
      const newExpanded = new Set(state.expandedTests);
      if (newExpanded.has(testKey)) {
        newExpanded.delete(testKey);
      } else {
        newExpanded.add(testKey);
      }
      return { expandedTests: newExpanded };
    });
  },

  expandAllFailed: () => {
    set((state) => {
      const expanded = new Set(state.expandedTests);
      for (const [key, result] of state.testResults) {
        if (result.status === "failed") {
          expanded.add(key);
        }
      }
      return { expandedTests: expanded };
    });
  },

  collapseAll: () => {
    set({ expandedTests: new Set() });
  },

  // --- B3nd settings ---

  setB3ndUrl: (url: string) => {
    localStorage.setItem("dashboard:b3ndUrl", url);
    set({ b3ndUrl: url });
  },

  setInspectorBasePath: (path: string) => {
    localStorage.setItem("dashboard:inspectorBasePath", path);
    set({ inspectorBasePath: path });
    // Reload data from the new base path
    get().loadStaticData();
  },

  setInspectorPort: (port: number) => {
    localStorage.setItem("dashboard:inspectorPort", String(port));
    set({ inspectorPort: port });
  },

  refreshAvailableBasePaths: async () => {
    const { b3ndUrl } = get();
    try {
      const res = await fetch(
        `${b3ndUrl}/api/v1/list/mutable/open/inspector`,
      );
      if (res.ok) {
        const data = await res.json();
        const items = data.data ?? data.items ?? [];
        const paths = items
          .map((item: { uri?: string; key?: string }) => {
            const uri = item.uri || item.key || "";
            // Extract base path from URI like "mutable://open/inspector/main/..."
            const match = uri.match(/inspector\/([^/]+)/);
            return match ? match[1] : null;
          })
          .filter((p: string | null): p is string => p !== null);
        // Deduplicate
        set({ availableBasePaths: [...new Set(paths)] as string[] });
      }
    } catch {
      // B3nd unavailable
    }
  },
}));

// Selector for filtered results
export function useFilteredResults() {
  const testResults = useDashboardStore((s) => s.testResults);
  const activeFacets = useDashboardStore((s) => s.activeFacets);

  const results = Array.from(testResults.values());

  if (activeFacets.size === 0) {
    return results;
  }

  const activeThemes: string[] = [];
  const activeBackends: string[] = [];
  const activeStatuses: string[] = [];
  const activeKeywords: string[] = [];

  for (const facetId of activeFacets) {
    if (facetId.startsWith("theme:")) activeThemes.push(facetId.slice(6));
    else if (facetId.startsWith("backend:")) activeBackends.push(facetId.slice(8));
    else if (facetId.startsWith("status:")) activeStatuses.push(facetId.slice(7));
    else if (facetId.startsWith("keyword:")) activeKeywords.push(facetId.slice(8));
  }

  return results.filter((result) => {
    if (activeThemes.length > 0 && !activeThemes.includes(result.theme)) return false;
    if (activeBackends.length > 0 && !activeBackends.includes(result.backend)) return false;
    if (activeStatuses.length > 0 && !activeStatuses.includes(result.status)) return false;

    if (activeKeywords.length > 0) {
      const searchText = `${result.name} ${result.file}`.toLowerCase();
      for (const keyword of activeKeywords) {
        if (!searchText.includes(keyword)) return false;
      }
    }

    return true;
  });
}
