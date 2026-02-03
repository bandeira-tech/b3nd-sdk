import { useMemo } from "react";
import {
  Check,
  X,
  SkipForward,
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  Filter,
} from "lucide-react";
import { useDashboardStore, useFilteredResults } from "../stores/dashboardStore";
import { cn } from "../../../utils";
import type { TestResult } from "../types";

const statusIcon: Record<string, { icon: typeof Check; color: string }> = {
  passed: { icon: Check, color: "text-green-500" },
  failed: { icon: X, color: "text-red-500" },
  skipped: { icon: SkipForward, color: "text-yellow-500" },
};

function TestDetailExpansion({ result }: { result: TestResult }) {
  return (
    <div className="border-t border-border/30 bg-muted/30 px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className="font-mono text-muted-foreground">{result.filePath}</span>
        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
          {result.theme}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
          {result.backend}
        </span>
        {result.duration !== undefined && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            {result.duration}ms
          </span>
        )}
      </div>

      {result.error && (
        <div className="mt-2 p-3 rounded bg-red-500/10 border border-red-500/20">
          <div className="font-medium text-red-600 dark:text-red-400 mb-1">
            {result.error.message}
          </div>
          {result.error.stack && (
            <pre className="text-[11px] text-red-500/80 whitespace-pre-wrap font-mono overflow-x-auto">
              {result.error.stack}
            </pre>
          )}
        </div>
      )}

      {!result.error && (
        <div className="text-muted-foreground italic">
          Test passed — no additional details.
        </div>
      )}
    </div>
  );
}

export function SearchResultsPanel() {
  const filteredResults = useFilteredResults();
  const {
    expandedTests,
    toggleTestExpansion,
    expandAllFailed,
    collapseAll,
    runSummary,
    activeFacets,
    testResults,
  } = useDashboardStore();

  const failedCount = useMemo(
    () => filteredResults.filter((r) => r.status === "failed").length,
    [filteredResults]
  );

  const hasFilters = activeFacets.size > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Results header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">
            {filteredResults.length}
            {hasFilters && ` / ${testResults.size}`} tests
          </span>
          {hasFilters && (
            <span className="flex items-center gap-1 text-xs text-primary">
              <Filter className="w-3 h-3" />
              Filtered
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <button
              onClick={expandAllFailed}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronsUpDown className="w-3 h-3" />
              Expand failed
            </button>
          )}
          {expandedTests.size > 0 && (
            <button
              onClick={collapseAll}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronsDownUp className="w-3 h-3" />
              Collapse all
            </button>
          )}
          {runSummary && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {runSummary.duration}ms
            </span>
          )}
        </div>
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {filteredResults.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No test results match the current filters.
          </div>
        ) : (
          <div>
            {filteredResults.map((result) => {
              const testKey = `${result.file}::${result.name}`;
              const isExpanded = expandedTests.has(testKey);
              const config = statusIcon[result.status] || statusIcon.passed;
              const StatusIcon = config.icon;

              return (
                <div key={testKey}>
                  <button
                    onClick={() => toggleTestExpansion(testKey)}
                    className={cn(
                      "w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors text-left",
                      "hover:bg-accent/40",
                      isExpanded && "bg-accent/20",
                      result.status === "failed" && "bg-red-500/5"
                    )}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    <StatusIcon
                      className={cn("w-3.5 h-3.5 flex-shrink-0", config.color)}
                    />
                    <span className="flex-1 font-mono text-xs truncate">
                      {result.name}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono flex-shrink-0">
                      {result.file}
                    </span>
                    {result.duration !== undefined && (
                      <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0 w-12 text-right">
                        {result.duration}ms
                      </span>
                    )}
                  </button>

                  {isExpanded && <TestDetailExpansion result={result} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
