import { useMemo, useCallback } from "react";
import { Terminal, ChevronDown, ChevronRight, Database, Radio, Upload } from "lucide-react";
import { useDashboardStore, useFilteredResults } from "../stores/dashboardStore";
import { TestRow } from "../molecules/TestRow";
import { RunInfo } from "../molecules/RunInfo";
import { ProgressRing } from "../atoms/ProgressRing";
import type { TestFilter, TestStatus, StaticTestData, TestTheme, BackendType } from "../types";
import { cn } from "../../../utils";

interface ResultsPanelProps {
  onRunTests: (filter?: TestFilter) => void;
  onCancelTests: () => void;
}

export function ResultsPanel({ onRunTests, onCancelTests }: ResultsPanelProps) {
  const {
    isRunning,
    testResults,
    runSummary,
    runMetadata,
    showRawOutput,
    setShowRawOutput,
    rawOutput,
    dataSource,
    setDataSource,
    loadStaticData,
    activeFacets,
  } = useDashboardStore();

  // Get filtered results based on active facets
  const filteredResults = useFilteredResults();

  // Calculate counts from all results
  const { counts, progress } = useMemo(() => {
    const results = Array.from(testResults.values());

    const countsMap: Record<TestStatus, number> = {
      running: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
    };

    for (const result of results) {
      countsMap[result.status]++;
    }

    const total = results.length;
    const completed = countsMap.passed + countsMap.failed + countsMap.skipped;

    return {
      counts: {
        running: countsMap.running,
        passed: countsMap.passed,
        failed: countsMap.failed,
        skipped: countsMap.skipped,
        total,
      },
      progress: total > 0 ? (completed / total) * 100 : 0,
    };
  }, [testResults]);

  // Sort filtered results: running first, then failed, then passed, then skipped
  const sortedResults = useMemo(() => {
    const statusOrder: Record<TestStatus, number> = {
      running: 0,
      failed: 1,
      passed: 2,
      skipped: 3,
      pending: 4,
    };
    return [...filteredResults].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  }, [filteredResults]);

  // Convert active facets to a TestFilter for running tests
  const getFilterFromFacets = useCallback((): TestFilter | undefined => {
    if (activeFacets.size === 0) return undefined;

    // Extract all themes and backends from active facets
    const themes: TestTheme[] = [];
    const backends: BackendType[] = [];

    for (const facetId of activeFacets) {
      if (facetId.startsWith("theme:")) {
        themes.push(facetId.replace("theme:", "") as TestTheme);
      } else if (facetId.startsWith("backend:")) {
        backends.push(facetId.replace("backend:", "") as BackendType);
      }
    }

    // Return filter with all selected themes/backends
    if (backends.length > 0 || themes.length > 0) {
      return {
        backends: backends.length > 0 ? backends : undefined,
        themes: themes.length > 0 ? themes : undefined,
      };
    }

    return undefined;
  }, [activeFacets]);

  // Handle loading static JSON data
  const handleLoadStaticData = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text) as StaticTestData;
        loadStaticData(data);
      } catch (err) {
        console.error("Failed to load static data:", err);
      }
    };
    input.click();
  };

  // Handle exporting current results as static data
  const handleExportResults = () => {
    const results = Array.from(testResults.values());
    const themes = useDashboardStore.getState().themes;

    const exportData: StaticTestData = {
      timestamp: Date.now(),
      runId: useDashboardStore.getState().currentRunId || `export-${Date.now()}`,
      summary: runSummary || {
        passed: counts.passed,
        failed: counts.failed,
        skipped: counts.skipped,
        total: counts.total,
        duration: 0,
      },
      results,
      themes,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `test-results-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isLive = dataSource === "live";

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header with controls */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          {/* Left: Run info (only for live mode) */}
          <div className="flex items-center gap-4">
            {isLive ? (
              <RunInfo
                isRunning={isRunning}
                runMetadata={runMetadata}
                onManualRun={() => onRunTests(getFilterFromFacets())}
                onCancel={onCancelTests}
              />
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Database className="w-4 h-4" />
                <span>Static Results</span>
              </div>
            )}
          </div>

          {/* Right: Data source toggle + stats */}
          <div className="flex items-center gap-4">
            {/* Data source toggle */}
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
              <button
                onClick={() => setDataSource("live")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors",
                  isLive
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Radio className="w-3.5 h-3.5" />
                Live
              </button>
              <button
                onClick={() => setDataSource("static")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors",
                  !isLive
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Database className="w-3.5 h-3.5" />
                Static
              </button>
            </div>

            {/* Import/Export */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleLoadStaticData}
                className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
                title="Load test results from JSON file"
              >
                <Upload className="w-4 h-4" />
              </button>
              {counts.total > 0 && (
                <button
                  onClick={handleExportResults}
                  className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
                  title="Export results as JSON"
                >
                  <Database className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Progress */}
            {isRunning && <ProgressRing progress={progress} size="sm" />}

            {/* Stats */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-500 font-medium">{counts.passed}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-red-500 font-medium">{counts.failed}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-yellow-500 font-medium">{counts.skipped}</span>
            </div>

            {runSummary && (
              <span className="text-xs text-muted-foreground">{runSummary.duration}ms</span>
            )}
          </div>
        </div>

        {/* Filter indicator */}
        {activeFacets.size > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            Showing {sortedResults.length} of {counts.total} results
          </div>
        )}
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {counts.total === 0 && !isRunning ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Terminal className="w-12 h-12 mb-4 opacity-50" />
            <div className="text-sm">No test results yet</div>
            {isLive ? (
              <div className="mt-2 text-xs">Tests run automatically on server startup</div>
            ) : (
              <button
                onClick={handleLoadStaticData}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Load results from JSON file
              </button>
            )}
          </div>
        ) : sortedResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <div className="text-sm">No results match the current filters</div>
          </div>
        ) : (
          <div>
            {sortedResults.map((result) => (
              <TestRow key={`${result.file}::${result.name}`} result={result} />
            ))}
          </div>
        )}
      </div>

      {/* Raw output toggle */}
      <div className="border-t border-border">
        <button
          onClick={() => setShowRawOutput(!showRawOutput)}
          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:bg-accent/50 transition-colors"
        >
          {showRawOutput ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          <Terminal className="w-4 h-4" />
          Raw Output
        </button>

        {showRawOutput && (
          <div className="max-h-48 overflow-auto bg-background border-t border-border">
            <pre className="p-4 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
              {rawOutput.length > 0 ? rawOutput.join("\n") : "No output yet"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
