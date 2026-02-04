import { useState, useCallback } from "react";
import { Plus, X, ChevronDown, ChevronRight, Search, Database, Zap, Check, XCircle, SkipForward, Loader2, Tag, Box } from "lucide-react";
import { useDashboardStore } from "../stores/dashboardStore";
import type { FacetGroup, FacetType } from "../types";
import { cn } from "../../../utils";

const facetTypeIcons: Record<FacetType, typeof Database> = {
  theme: Database,
  backend: Box,
  status: Zap,
  keyword: Tag,
};

const statusIcons: Record<string, typeof Check> = {
  passed: Check,
  failed: XCircle,
  skipped: SkipForward,
  running: Loader2,
};

const statusColors: Record<string, string> = {
  passed: "text-green-500",
  failed: "text-red-500",
  skipped: "text-yellow-500",
  running: "text-blue-500",
};

export function FacetPanel() {
  const {
    facetGroups,
    activeFacets,
    toggleFacet,
    clearFacets,
    addCustomKeyword,
    removeCustomKeyword,
  } = useDashboardStore();

  const [newKeyword, setNewKeyword] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const handleAddKeyword = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (newKeyword.trim()) {
        addCustomKeyword(newKeyword);
        setNewKeyword("");
      }
    },
    [newKeyword, addCustomKeyword]
  );

  const toggleGroupExpansion = useCallback(
    (groupId: string) => {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      });
    },
    []
  );

  const activeCount = activeFacets.size;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Filters
          </h2>
          {activeCount > 0 && (
            <button
              onClick={clearFacets}
              className="text-xs text-primary hover:underline"
            >
              Clear all ({activeCount})
            </button>
          )}
        </div>

        {/* Add custom keyword */}
        <form onSubmit={handleAddKeyword} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Add keyword filter..."
            className="w-full pl-9 pr-9 py-2 text-sm bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {newKeyword && (
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded"
            >
              <Plus className="w-4 h-4 text-primary" />
            </button>
          )}
        </form>
      </div>

      {/* Active facets chips */}
      {activeCount > 0 && (
        <div className="px-4 py-2 border-b border-border bg-muted/30">
          <div className="flex flex-wrap gap-1.5">
            {Array.from(activeFacets).map((facetId) => {
              const [type, value] = facetId.split(":");
              return (
                <button
                  key={facetId}
                  onClick={() => {
                    if (type === "keyword") {
                      removeCustomKeyword(value);
                    } else {
                      toggleFacet(facetId);
                    }
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full",
                    "bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  )}
                >
                  <span className="truncate max-w-[100px]">{value}</span>
                  <X className="w-3 h-3 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Facet groups */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {facetGroups.map((group) => (
          <FacetGroupSection
            key={group.id}
            group={{ ...group, expanded: !collapsedGroups.has(group.id) }}
            activeFacets={activeFacets}
            onToggleFacet={toggleFacet}
            onToggleExpand={() => toggleGroupExpansion(group.id)}
            onRemoveKeyword={removeCustomKeyword}
          />
        ))}
      </div>
    </div>
  );
}

interface FacetGroupSectionProps {
  group: FacetGroup;
  activeFacets: Set<string>;
  onToggleFacet: (facetId: string) => void;
  onToggleExpand: () => void;
  onRemoveKeyword: (keyword: string) => void;
}

function FacetGroupSection({
  group,
  activeFacets,
  onToggleFacet,
  onToggleExpand,
  onRemoveKeyword,
}: FacetGroupSectionProps) {
  const GroupIcon = facetTypeIcons[group.type];
  const activeInGroup = group.facets.filter((f) => activeFacets.has(f.id)).length;

  return (
    <div className="border-b border-border">
      {/* Group header */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50 transition-colors"
      >
        {group.expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
        <GroupIcon className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium text-sm flex-1 text-left">{group.label}</span>
        {activeInGroup > 0 && (
          <span className="px-1.5 py-0.5 text-xs rounded-full bg-primary text-primary-foreground">
            {activeInGroup}
          </span>
        )}
      </button>

      {/* Facets */}
      {group.expanded && (
        <div className="pb-2">
          {group.facets.map((facet) => {
            const isActive = activeFacets.has(facet.id);
            const StatusIcon = group.type === "status" ? statusIcons[facet.value] : null;
            const statusColor = group.type === "status" ? statusColors[facet.value] : "";

            return (
              <button
                key={facet.id}
                onClick={() => {
                  if (group.type === "keyword") {
                    // For keywords, clicking the X removes them
                  } else {
                    onToggleFacet(facet.id);
                  }
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-4 py-1.5 text-sm transition-colors",
                  "hover:bg-accent/50",
                  isActive && "bg-primary/5"
                )}
              >
                {/* Checkbox or status icon */}
                <div
                  className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0",
                    isActive
                      ? "bg-primary border-primary"
                      : "border-border"
                  )}
                >
                  {isActive && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>

                {/* Status icon for status facets */}
                {StatusIcon && (
                  <StatusIcon className={cn("w-3.5 h-3.5 flex-shrink-0", statusColor)} />
                )}

                {/* Label */}
                <span className={cn("flex-1 text-left truncate", isActive && "font-medium")}>
                  {facet.label}
                </span>

                {/* Count badge */}
                {facet.count !== undefined && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {facet.count}
                  </span>
                )}

                {/* Remove button for keywords */}
                {group.type === "keyword" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveKeyword(facet.value);
                    }}
                    className="p-0.5 hover:bg-accent rounded"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
              </button>
            );
          })}

          {group.facets.length === 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground italic">
              No {group.label.toLowerCase()} available
            </div>
          )}
        </div>
      )}
    </div>
  );
}
