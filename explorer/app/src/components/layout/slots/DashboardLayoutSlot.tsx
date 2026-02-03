import { useEffect } from "react";
import { Activity, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useDashboardStore } from "../../dashboard/stores/dashboardStore";
import { SearchResultsPanel } from "../../dashboard/panels/SearchResultsPanel";
import { RawLogsPanel } from "../../dashboard/panels/RawLogsPanel";

export function DashboardLayoutSlot() {
  const { loading, error, staticData, contentMode, loadStaticData } =
    useDashboardStore();

  useEffect(() => {
    loadStaticData();
  }, [loadStaticData]);

  if (loading && !staticData) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading test results...
      </div>
    );
  }

  if (error && !staticData) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <div className="text-sm">{error}</div>
        <button
          onClick={() => loadStaticData()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg">Developer Dashboard</h1>
        </div>

        {staticData && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Built {new Date(staticData.generatedAt).toLocaleString()}
            </span>
            <span className="text-border">|</span>
            <span>Deno {staticData.runMetadata.environment.deno}</span>
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {contentMode === "results" ? (
          <SearchResultsPanel />
        ) : (
          <RawLogsPanel />
        )}
      </div>
    </div>
  );
}
