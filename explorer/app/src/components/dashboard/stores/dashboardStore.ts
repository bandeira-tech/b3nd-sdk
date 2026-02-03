import { create } from "zustand";
import type {
  DashboardState,
  DashboardActions,
  TestResult,
  FacetGroup,
  ContentMode,
  StaticTestData,
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
};

export interface DashboardStore extends DashboardState, DashboardActions {}

/**
 * Populate facet counts from test results
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

    return {
      ...group,
      facets: group.facets
        .map((f) => ({ ...f, count: countsMap[f.value] || 0 }))
        .filter((f) => f.count > 0 || group.type === "status"),
    };
  });
}

/**
 * Load static data into the store's format
 */
function loadData(data: StaticTestData) {
  const resultsMap = new Map<string, TestResult>();
  for (const result of data.results) {
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

  loadStaticData: async () => {
    set({ loading: true, error: null });

    try {
      // Load test results
      const resultsRes = await fetch("/dashboard/test-results.json");
      if (!resultsRes.ok) throw new Error(`Failed to load test results: ${resultsRes.status}`);
      const data: StaticTestData = await resultsRes.json();

      // Load raw logs
      let rawLogs = "";
      try {
        const logsRes = await fetch("/dashboard/test-logs.txt");
        if (logsRes.ok) rawLogs = await logsRes.text();
      } catch {
        // Logs are optional
      }

      const { resultsMap, expanded } = loadData(data);
      const results = Array.from(resultsMap.values());
      const updatedGroups = updateFacetCounts(get().facetGroups, results);

      set({
        loading: false,
        staticData: data,
        testResults: resultsMap,
        runSummary: data.summary,
        facetGroups: updatedGroups,
        expandedTests: expanded,
        rawLogs,
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

  // Facets
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

  // Inline expansion
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
