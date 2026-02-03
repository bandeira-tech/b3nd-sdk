import { create } from "zustand";
import type {
  DashboardState,
  DashboardActions,
  ThemeGroup,
  BackendGroup,
  TestResult,
  TestRunSummary,
  ServiceHealth,
  FileChangeEvent,
  TestFilter,
  FacetGroup,
  DataSourceType,
  StaticTestData,
  RunMetadata,
  LeftPanelView,
  SourceFile,
} from "../types";

// Default facet groups for themes (high-level categories)
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
    { id: "theme:other", type: "theme", label: "Other", value: "other" },
  ],
};

// Default facet groups for backends (storage/transport)
const DEFAULT_BACKEND_FACETS: FacetGroup = {
  id: "backends",
  label: "Backends",
  type: "backend",
  expanded: true,
  facets: [
    { id: "backend:memory", type: "backend", label: "Memory", value: "memory" },
    { id: "backend:http", type: "backend", label: "HTTP", value: "http" },
    { id: "backend:websocket", type: "backend", label: "WebSocket", value: "websocket" },
    { id: "backend:postgres", type: "backend", label: "PostgreSQL", value: "postgres" },
    { id: "backend:mongo", type: "backend", label: "MongoDB", value: "mongo" },
    { id: "backend:localstorage", type: "backend", label: "LocalStorage", value: "localstorage" },
    { id: "backend:indexeddb", type: "backend", label: "IndexedDB", value: "indexeddb" },
  ],
};

const DEFAULT_STATUS_FACETS: FacetGroup = {
  id: "status",
  label: "Status",
  type: "status",
  expanded: true,
  facets: [
    { id: "status:passed", type: "status", label: "Passed", value: "passed" },
    { id: "status:failed", type: "status", label: "Failed", value: "failed" },
    { id: "status:skipped", type: "status", label: "Skipped", value: "skipped" },
    { id: "status:running", type: "status", label: "Running", value: "running" },
  ],
};

const initialState: DashboardState = {
  // Connection
  wsConnected: false,
  wsError: null,

  // Data source
  dataSource: "live",
  staticData: null,

  // Test discovery
  themes: [],
  backends: [],
  totalTests: 0,

  // Facets - themes first, then backends, then status
  facetGroups: [DEFAULT_STATUS_FACETS, DEFAULT_THEME_FACETS, DEFAULT_BACKEND_FACETS],
  activeFacets: new Set(),
  customKeywords: [],

  // Test run
  isRunning: false,
  currentRunId: null,
  testResults: new Map(),
  runSummary: null,
  runMetadata: { current: null, last: null },

  // Health
  services: [],

  // File changes
  recentChanges: [],
  autoRunEnabled: false,

  // UI
  showRawOutput: false,
  rawOutput: [],

  // Navigation
  activeView: "tests",
  selectedSourceFile: null,
  sourceContent: null,
  sourceLoading: false,
  logLines: [],
  logLoading: false,
  highlightedTestName: null,
};

export interface DashboardStore extends DashboardState, DashboardActions {}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  ...initialState,

  // Connection
  setWsConnected: (connected: boolean) => {
    set({ wsConnected: connected });
  },

  setWsError: (error: string | null) => {
    set({ wsError: error });
  },

  // Data source
  setDataSource: (source: DataSourceType) => {
    set({ dataSource: source });
    // If switching to static and we have static data, load it
    if (source === "static") {
      const { staticData } = get();
      if (staticData) {
        const resultsMap = new Map<string, TestResult>();
        for (const result of staticData.results) {
          const key = `${result.file}::${result.name}`;
          resultsMap.set(key, result);
        }
        set({
          testResults: resultsMap,
          runSummary: staticData.summary,
          themes: staticData.themes,
        });
      }
    }
  },

  loadStaticData: (data: StaticTestData) => {
    const resultsMap = new Map<string, TestResult>();
    for (const result of data.results) {
      const key = `${result.file}::${result.name}`;
      resultsMap.set(key, result);
    }
    set({
      staticData: data,
      dataSource: "static",
      testResults: resultsMap,
      runSummary: data.summary,
      themes: data.themes,
      totalTests: data.themes.reduce((sum, t) => sum + t.testCount, 0),
    });
  },

  // Test discovery
  setThemes: (themes: ThemeGroup[], backends: BackendGroup[], totalTests: number) => {
    // Update theme and backend facet counts based on actual data
    const currentGroups = get().facetGroups;
    const updatedGroups = currentGroups.map((group) => {
      if (group.type === "theme") {
        return {
          ...group,
          facets: group.facets
            .map((facet) => {
              const theme = themes.find((t) => t.id === facet.value);
              return { ...facet, count: theme?.testCount || 0 };
            })
            .filter((facet) => facet.count > 0 || facet.value !== "other"),
        };
      }
      if (group.type === "backend") {
        return {
          ...group,
          facets: group.facets
            .map((facet) => {
              const backend = backends.find((b) => b.id === facet.value);
              return { ...facet, count: backend?.testCount || 0 };
            })
            .filter((facet) => facet.count > 0), // Only show backends with tests
        };
      }
      return group;
    });

    set({ themes, backends, totalTests, facetGroups: updatedGroups });
  },

  // Facets
  setFacetGroups: (groups: FacetGroup[]) => {
    set({ facetGroups: groups });
  },

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

      // Add to facet groups
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
        // Create new keywords group
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

      // Auto-activate the new keyword facet
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

      // Remove from facet groups
      const updatedGroups = state.facetGroups
        .map((g) => {
          if (g.id === "keywords") {
            return {
              ...g,
              facets: g.facets.filter((f) => f.id !== facetId),
            };
          }
          return g;
        })
        .filter((g) => g.id !== "keywords" || g.facets.length > 0);

      // Remove from active facets
      const newActive = new Set(state.activeFacets);
      newActive.delete(facetId);

      return {
        customKeywords: newKeywords,
        facetGroups: updatedGroups,
        activeFacets: newActive,
      };
    });
  },

  // Test run
  startRun: (runId: string, _filter: TestFilter | null) => {
    set({
      isRunning: true,
      currentRunId: runId,
      testResults: new Map(),
      runSummary: null,
      rawOutput: [],
    });
  },

  addTestResult: (result: TestResult) => {
    set((state) => {
      const key = `${result.file}::${result.name}`;
      const newResults = new Map(state.testResults);
      newResults.set(key, result);

      // Update status facet counts
      const statusCounts: Record<string, number> = {
        passed: 0,
        failed: 0,
        skipped: 0,
        running: 0,
      };
      for (const r of newResults.values()) {
        if (statusCounts[r.status] !== undefined) {
          statusCounts[r.status]++;
        }
      }

      const updatedGroups = state.facetGroups.map((group) => {
        if (group.type === "status") {
          return {
            ...group,
            facets: group.facets.map((facet) => ({
              ...facet,
              count: statusCounts[facet.value] || 0,
            })),
          };
        }
        return group;
      });

      return { testResults: newResults, facetGroups: updatedGroups };
    });
  },

  completeRun: (summary: TestRunSummary) => {
    set({
      isRunning: false,
      runSummary: summary,
    });
  },

  cancelRun: () => {
    set({
      isRunning: false,
      currentRunId: null,
    });
  },

  clearResults: () => {
    set({
      testResults: new Map(),
      runSummary: null,
      rawOutput: [],
    });
  },

  setRunMetadata: (metadata: { current: RunMetadata | null; last: RunMetadata | null }) => {
    set({ runMetadata: metadata, isRunning: metadata.current !== null });
  },

  loadInitialState: (state: { results: TestResult[]; runMetadata: { current: RunMetadata | null; last: RunMetadata | null } }) => {
    const resultsMap = new Map<string, TestResult>();
    for (const result of state.results) {
      const key = `${result.file}::${result.name}`;
      resultsMap.set(key, result);
    }

    // Calculate summary from results
    let passed = 0, failed = 0, skipped = 0, duration = 0;
    for (const result of state.results) {
      if (result.status === "passed") passed++;
      else if (result.status === "failed") failed++;
      else if (result.status === "skipped") skipped++;
      if (result.duration) duration += result.duration;
    }

    set({
      testResults: resultsMap,
      runMetadata: state.runMetadata,
      isRunning: state.runMetadata.current !== null,
      runSummary: {
        passed,
        failed,
        skipped,
        total: state.results.length,
        duration,
      },
    });
  },

  // Health
  setServices: (services: ServiceHealth[]) => {
    set({ services });
  },

  // File changes
  addFileChange: (event: FileChangeEvent) => {
    set((state) => ({
      recentChanges: [event, ...state.recentChanges].slice(0, 10),
    }));
  },

  setAutoRunEnabled: (enabled: boolean) => {
    set({ autoRunEnabled: enabled });
  },

  // UI
  setShowRawOutput: (show: boolean) => {
    set({ showRawOutput: show });
  },

  addRawOutput: (line: string) => {
    set((state) => ({
      rawOutput: [...state.rawOutput, line].slice(-500),
    }));
  },

  clearRawOutput: () => {
    set({ rawOutput: [] });
  },

  // Navigation
  setActiveView: (view: LeftPanelView) => {
    set({ activeView: view });
  },

  setSelectedSourceFile: (file: string | null) => {
    set({ selectedSourceFile: file });
  },

  setSourceContent: (content: SourceFile | null) => {
    set({ sourceContent: content });
  },

  setSourceLoading: (loading: boolean) => {
    set({ sourceLoading: loading });
  },

  setLogLines: (lines: string[]) => {
    set({ logLines: lines });
  },

  setLogLoading: (loading: boolean) => {
    set({ logLoading: loading });
  },

  setHighlightedTestName: (name: string | null) => {
    set({ highlightedTestName: name });
  },

  navigateToSource: (filePath: string, testName?: string) => {
    set({
      activeView: "code",
      selectedSourceFile: filePath,
      highlightedTestName: testName || null,
    });
  },
}));

// Selector to get filtered results based on active facets
export function useFilteredResults() {
  const testResults = useDashboardStore((s) => s.testResults);
  const activeFacets = useDashboardStore((s) => s.activeFacets);
  const customKeywords = useDashboardStore((s) => s.customKeywords);

  const results = Array.from(testResults.values());

  if (activeFacets.size === 0 && customKeywords.length === 0) {
    return results;
  }

  // Parse active facets into filters
  const activeThemes: string[] = [];
  const activeBackends: string[] = [];
  const activeStatuses: string[] = [];
  const activeKeywords: string[] = [];

  for (const facetId of activeFacets) {
    if (facetId.startsWith("theme:")) {
      activeThemes.push(facetId.replace("theme:", ""));
    } else if (facetId.startsWith("backend:")) {
      activeBackends.push(facetId.replace("backend:", ""));
    } else if (facetId.startsWith("status:")) {
      activeStatuses.push(facetId.replace("status:", ""));
    } else if (facetId.startsWith("keyword:")) {
      activeKeywords.push(facetId.replace("keyword:", ""));
    }
  }

  return results.filter((result) => {
    // Theme filter (OR within themes)
    if (activeThemes.length > 0 && !activeThemes.includes(result.theme)) {
      return false;
    }

    // Backend filter (OR within backends)
    if (activeBackends.length > 0 && !activeBackends.includes(result.backend)) {
      return false;
    }

    // Status filter (OR within statuses)
    if (activeStatuses.length > 0 && !activeStatuses.includes(result.status)) {
      return false;
    }

    // Keyword filter (AND - all keywords must match)
    if (activeKeywords.length > 0) {
      const searchText = `${result.name} ${result.file}`.toLowerCase();
      for (const keyword of activeKeywords) {
        if (!searchText.includes(keyword)) {
          return false;
        }
      }
    }

    return true;
  });
}
