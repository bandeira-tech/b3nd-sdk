import { create } from "zustand";

/**
 * Navigation + coordination state for the roadmap app.
 * Content lives at URIs and is read through useRead by the components.
 */
interface RoadmapStore {
  activeGroup: string | null;
  activeStory: string | null;
  filterPriority: string | null;
  filterStatus: string | null;
  filterWave: number | null;
  searchQuery: string;
  launchedStories: Set<string>;
  viewMode: "groups" | "tags";
  activeTag: string | null;
  catalogRefreshKey: number;

  openGroup: (id: string) => void;
  closeGroup: () => void;
  openStory: (id: string) => void;
  closeStory: () => void;
  setFilterPriority: (priority: string | null) => void;
  setFilterStatus: (status: string | null) => void;
  setFilterWave: (wave: number | null) => void;
  setSearchQuery: (query: string) => void;
  markLaunched: (id: string) => void;
  setViewMode: (mode: "groups" | "tags") => void;
  setActiveTag: (tag: string | null) => void;
  clearFilters: () => void;
  bumpRefresh: () => void;
}

export const useRoadmapStore = create<RoadmapStore>((set) => ({
  activeGroup: null,
  activeStory: null,
  filterPriority: null,
  filterStatus: null,
  filterWave: null,
  searchQuery: "",
  launchedStories: new Set(),
  viewMode: "groups",
  activeTag: null,
  catalogRefreshKey: 0,

  openGroup: (id) => set({ activeGroup: id, activeStory: null }),
  closeGroup: () => set({ activeGroup: null, activeStory: null }),
  openStory: (id) => set({ activeStory: id }),
  closeStory: () => set({ activeStory: null }),
  setFilterPriority: (priority) => set({ filterPriority: priority }),
  setFilterStatus: (status) => set({ filterStatus: status }),
  setFilterWave: (wave) => set({ filterWave: wave }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  markLaunched: (id) =>
    set((state) => {
      const next = new Set(state.launchedStories);
      next.add(id);
      return { launchedStories: next };
    }),
  setViewMode: (mode) => set({ viewMode: mode, activeTag: null }),
  setActiveTag: (tag) => set({ activeTag: tag }),
  clearFilters: () => set({ filterPriority: null, filterStatus: null, filterWave: null }),
  bumpRefresh: () => set((s) => ({ catalogRefreshKey: s.catalogRefreshKey + 1 })),
}));
