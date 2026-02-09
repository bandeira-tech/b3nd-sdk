import { useEffect, useState, useRef } from "react";
import { Activity, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { useDashboardStore } from "../../dashboard/stores/dashboardStore";
import { SearchResultsPanel } from "../../dashboard/panels/SearchResultsPanel";
import { RawLogsPanel } from "../../dashboard/panels/RawLogsPanel";
import { cn } from "../../../utils";

const POLL_INTERVAL_MS = 10_000;

export function DashboardLayoutSlot() {
  const {
    loading,
    error,
    staticData,
    contentMode,
    loadStaticData,
    dataSource,
    testResults,
    b3ndUri,
    setB3ndUri,
  } = useDashboardStore();

  const [editUri, setEditUri] = useState(b3ndUri);
  const pollRef = useRef<number | null>(null);

  // Load data on mount
  useEffect(() => {
    loadStaticData();
  }, [loadStaticData]);

  // Poll for updates when a B3nd URI is set
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (b3ndUri) {
      pollRef.current = window.setInterval(() => loadStaticData(), POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [b3ndUri, loadStaticData]);

  const hasData = testResults.size > 0;

  if (loading && !hasData) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading test results...
      </div>
    );
  }

  if (error && !hasData) {
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

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {staticData?.generatedAt && (
            <span>
              Built {new Date(staticData.generatedAt).toLocaleString()}
            </span>
          )}

          {/* B3nd URI input — empty = static file mode */}
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (editUri !== b3ndUri) {
                setB3ndUri(editUri);
              }
            }}
          >
            <input
              type="text"
              value={editUri}
              onChange={(e) => setEditUri(e.target.value)}
              placeholder="mutable://open/..."
              className="bg-background border border-border rounded px-2 py-0.5 font-mono text-[11px] w-64 text-foreground placeholder:text-muted-foreground/50"
            />
          </form>

          {/* Data source badge */}
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
            dataSource === "b3nd" ? "bg-blue-500/10 text-blue-500" :
            "bg-muted text-muted-foreground"
          )}>
            {dataSource}
          </span>

          {/* Manual refresh */}
          <button
            onClick={() => loadStaticData()}
            className="p-1 rounded hover:bg-accent transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
        </div>
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
