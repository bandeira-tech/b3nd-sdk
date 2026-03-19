import { useState, useMemo } from "react";
import {
  ChevronDown, ChevronRight, Map as MapIcon,
  Filter, Search, X, Tag, Layers,
} from "lucide-react";
import { cn } from "../../utils";
import { useRoadmapStore } from "./useRoadmapStore";
import { useRead } from "../learn/useRead";
import {
  PRIORITY_COLORS, PRIORITY_ORDER, STATUS_COLORS,
  type RoadmapCatalog, type RoadmapStoryMeta,
} from "./roadmapTypes";

const CATALOG_URI = "mutable://open/rig/roadmap/catalog";

export function RoadmapLeftSlot() {
  const { data: catalog } = useRead<RoadmapCatalog>(CATALOG_URI);
  if (!catalog) return null;
  return <IndexMode catalog={catalog} />;
}

/* -- Index Mode (always shown, even when a story is active) -------------- */

function IndexMode({ catalog }: { catalog: RoadmapCatalog }) {
  const openGroup = useRoadmapStore((s) => s.openGroup);
  const openStory = useRoadmapStore((s) => s.openStory);
  const activeGroup = useRoadmapStore((s) => s.activeGroup);
  const activeStory = useRoadmapStore((s) => s.activeStory);
  const closeStory = useRoadmapStore((s) => s.closeStory);
  const filterPriority = useRoadmapStore((s) => s.filterPriority);
  const filterStatus = useRoadmapStore((s) => s.filterStatus);
  const filterWave = useRoadmapStore((s) => s.filterWave);
  const setFilterPriority = useRoadmapStore((s) => s.setFilterPriority);
  const setFilterStatus = useRoadmapStore((s) => s.setFilterStatus);
  const setFilterWave = useRoadmapStore((s) => s.setFilterWave);
  const clearFilters = useRoadmapStore((s) => s.clearFilters);
  const searchQuery = useRoadmapStore((s) => s.searchQuery);
  const setSearchQuery = useRoadmapStore((s) => s.setSearchQuery);
  const viewMode = useRoadmapStore((s) => s.viewMode);
  const setViewMode = useRoadmapStore((s) => s.setViewMode);
  const activeTag = useRoadmapStore((s) => s.activeTag);
  const setActiveTag = useRoadmapStore((s) => s.setActiveTag);
  const launchedStories = useRoadmapStore((s) => s.launchedStories);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(activeGroup ? [activeGroup] : catalog.groups.map((g) => g.id)),
  );

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [showFilters, setShowFilters] = useState(false);
  const hasFilters = filterPriority !== null || filterStatus !== null || filterWave !== null;

  // Compute unique wave numbers
  const waveNumbers = useMemo(() => {
    const waves = new Set(catalog.stories.map((s) => s.wave ?? 0));
    return [...waves].sort((a, b) => a - b);
  }, [catalog.stories]);

  // Current wave = lowest wave with unfinished stories
  const currentWave = useMemo(() => {
    for (const w of waveNumbers) {
      const hasUnfinished = catalog.stories.some((s) => (s.wave ?? 0) === w && s.status !== "merged");
      if (hasUnfinished) return w;
    }
    return waveNumbers[0] ?? 0;
  }, [catalog.stories, waveNumbers]);

  // Search-filtered stories
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return catalog.stories.filter((s) =>
      s.id.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q)) ||
      s.category.toLowerCase().includes(q) ||
      (s.keywords ?? []).some((k) => k.includes(q))
    );
  }, [catalog.stories, searchQuery]);

  const filteredStories = useMemo(() => {
    let stories = catalog.stories;
    if (activeGroup) stories = stories.filter((s) => s.group === activeGroup);
    if (filterPriority) stories = stories.filter((s) => s.priority === filterPriority);
    if (filterStatus) stories = stories.filter((s) => s.status === filterStatus);
    if (filterWave !== null) stories = stories.filter((s) => (s.wave ?? 0) === filterWave);
    return stories;
  }, [catalog.stories, activeGroup, filterPriority, filterStatus, filterWave]);

  const storiesByGroup = useMemo(() => {
    const map = new Map<string, RoadmapStoryMeta[]>();
    for (const s of filteredStories) {
      const list = map.get(s.group) || [];
      list.push(s);
      map.set(s.group, list);
    }
    return map;
  }, [filteredStories]);

  // Tag browser: group stories by shared concern tag
  const storiesByTag = useMemo(() => {
    if (viewMode !== "tags") return new Map<string, RoadmapStoryMeta[]>();
    const map = new Map<string, RoadmapStoryMeta[]>();
    for (const concern of catalog.sharedConcerns ?? []) {
      const stories = concern.storyIds
        .map((id) => catalog.stories.find((s) => s.id === id))
        .filter(Boolean) as RoadmapStoryMeta[];
      map.set(concern.tag, stories);
    }
    return map;
  }, [catalog, viewMode]);

  // Check if story is next-unblocked in its group
  const unblockedSet = useMemo(() => {
    const set = new Set<string>();
    for (const g of catalog.groups) {
      for (const id of g.nextUnblocked ?? []) set.add(id);
    }
    return set;
  }, [catalog.groups]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 mb-2">
          <MapIcon className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium flex-1">Roadmap</span>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "p-1 rounded hover:bg-accent/50 transition-colors",
              hasFilters && "text-primary",
            )}
          >
            <Filter className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stories..."
            className="w-full pl-7 pr-7 py-1.5 text-xs bg-accent/30 border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* View mode toggle */}
        <div className="flex gap-1 mt-2">
          <button
            onClick={() => setViewMode("groups")}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors",
              viewMode === "groups"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Layers className="w-3 h-3" />
            Groups
          </button>
          <button
            onClick={() => setViewMode("tags")}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors",
              viewMode === "tags"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Tag className="w-3 h-3" />
            Tags
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-border bg-card/50 space-y-2">
          {/* Priority */}
          <div className="flex flex-wrap gap-1">
            {PRIORITY_ORDER.map((p) => (
              <FilterChip
                key={p}
                label={p}
                active={filterPriority === p}
                dotColor={PRIORITY_COLORS[p]}
                onClick={() => setFilterPriority(filterPriority === p ? null : p)}
              />
            ))}
          </div>
          {/* Status */}
          <div className="flex flex-wrap gap-1">
            {["pending", "in-progress", "review", "merged"].map((s) => (
              <FilterChip
                key={s}
                label={s}
                active={filterStatus === s}
                dotColor={STATUS_COLORS[s]}
                onClick={() => setFilterStatus(filterStatus === s ? null : s)}
              />
            ))}
          </div>
          {/* Waves */}
          <div className="flex flex-wrap gap-1">
            {waveNumbers.map((w) => {
              const waveStories = catalog.stories.filter((s) => (s.wave ?? 0) === w);
              const waveCount = waveStories.length;
              const isCurrent = w === currentWave;
              return (
                <button
                  key={w}
                  onClick={() => setFilterWave(filterWave === w ? null : w)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-colors border",
                    filterWave === w
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border bg-card hover:bg-accent/50 text-muted-foreground",
                  )}
                >
                  W{w}
                  <span className="text-muted-foreground/60">{waveCount}</span>
                  {isCurrent && filterWave !== w && (
                    <span className="text-[8px] text-primary font-medium ml-0.5">now</span>
                  )}
                </button>
              );
            })}
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Story list — always visible, highlights active story */}
      <div className="flex-1 overflow-auto custom-scrollbar py-1">
        {/* Search results mode */}
        {searchResults !== null ? (
          <div>
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
            </div>
            {searchResults.map((story) => (
              <StoryRow
                key={story.id}
                story={story}
                onClick={() => openStory(story.id)}
                isActive={story.id === activeStory}
                isUnblocked={unblockedSet.has(story.id)}
                isLaunched={launchedStories.has(story.id)}
              />
            ))}
          </div>
        ) : viewMode === "tags" ? (
          /* Tags browser mode */
          <div>
            {[...(storiesByTag.entries())].map(([tag, stories]) => (
              <CollapsibleGroup
                key={tag}
                label={tag}
                count={stories.length}
                expanded={activeTag === tag}
                onToggle={() => setActiveTag(activeTag === tag ? null : tag)}
              >
                {stories.map((story) => (
                  <StoryRow
                    key={story.id}
                    story={story}
                    onClick={() => openStory(story.id)}
                    isActive={story.id === activeStory}
                    isUnblocked={unblockedSet.has(story.id)}
                    isLaunched={launchedStories.has(story.id)}
                  />
                ))}
              </CollapsibleGroup>
            ))}
          </div>
        ) : (
          /* Groups mode (default) */
          catalog.groups.map((group) => {
            const groupStories = storiesByGroup.get(group.id) || [];
            if (activeGroup && group.id !== activeGroup) return null;
            if (groupStories.length === 0 && (filterPriority || filterStatus || filterWave !== null)) return null;

            return (
              <CollapsibleGroup
                key={group.id}
                label={group.name}
                count={groupStories.length}
                expanded={expandedGroups.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
              >
                {groupStories.map((story) => (
                  <StoryRow
                    key={story.id}
                    story={story}
                    onClick={() => story.id === activeStory ? closeStory() : openStory(story.id)}
                    isActive={story.id === activeStory}
                    isUnblocked={unblockedSet.has(story.id)}
                    isLaunched={launchedStories.has(story.id)}
                  />
                ))}
              </CollapsibleGroup>
            );
          })
        )}
      </div>
    </div>
  );
}

/* -- Story Row ----------------------------------------------------------- */

function StoryRow({
  story, onClick, isActive, isUnblocked, isLaunched,
}: {
  story: RoadmapStoryMeta;
  onClick: () => void;
  isActive: boolean;
  isUnblocked: boolean;
  isLaunched: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-left transition-colors",
        isActive
          ? "bg-primary/10 border-l-2 border-primary"
          : "hover:bg-accent/50",
      )}
    >
      <span className={cn("w-2 h-2 rounded-full shrink-0", PRIORITY_COLORS[story.priority])} />
      <span className={cn(
        "text-[10px] font-mono shrink-0 w-16",
        isActive ? "text-primary" : "text-muted-foreground",
      )}>
        {story.id}
      </span>
      <span className={cn(
        "text-xs truncate flex-1",
        isActive ? "text-primary font-medium" : "text-foreground",
      )}>
        {story.title}
      </span>
      {isUnblocked && story.status === "pending" && (
        <span className="text-[8px] px-1 py-0.5 rounded bg-green-500/15 text-green-400 shrink-0">
          now
        </span>
      )}
      {isLaunched && (
        <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400 shrink-0">
          sent
        </span>
      )}
      {story.pr && !isActive && (
        <span className={cn(
          "text-[9px] font-mono shrink-0 px-1 rounded",
          story.status === "merged" ? "bg-green-500/20 text-green-400" :
          story.status === "in-progress" ? "bg-blue-500/20 text-blue-400" :
          "bg-zinc-500/20 text-zinc-400",
        )}>
          #{story.pr.number}
        </span>
      )}
    </button>
  );
}

/* -- Shared Components --------------------------------------------------- */

function CollapsibleGroup({
  label, count, expanded, onToggle, children,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors flex-1"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0" />
          )}
          <span className="font-semibold">{label}</span>
          <span className="text-muted-foreground/50 ml-auto normal-case">{count}</span>
        </button>
      </div>
      {expanded && children}
    </div>
  );
}

function FilterChip({
  label, active, dotColor, onClick,
}: {
  label: string;
  active: boolean;
  dotColor: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-colors border",
        active
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-border bg-card hover:bg-accent/50 text-muted-foreground",
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
      {label}
    </button>
  );
}
