import { useEffect } from "react";
import { Activity, Loader2, AlertCircle, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useDashboardStore } from "../../dashboard/stores/dashboardStore";
import { useDashboardWs } from "../../dashboard/hooks/useDashboardWs";
import { SearchResultsPanel } from "../../dashboard/panels/SearchResultsPanel";
import { RawLogsPanel } from "../../dashboard/panels/RawLogsPanel";
import { cn } from "../../../utils";

export function DashboardLayoutSlot() {
  const {
    loading,
    error,
    staticData,
    contentMode,
    loadStaticData,
    wsConnected,
    wsError,
    dataSource,
    testResults,
  } = useDashboardStore();

  // Establish WebSocket connection for live streaming updates
  useDashboardWs();

  // Load static data as the primary data source (written by backend after each run)
  useEffect(() => {
    loadStaticData();
  }, [loadStaticData]);

  const isLive = dataSource === "live";
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
            <>
              <span>
                Built {new Date(staticData.generatedAt).toLocaleString()}
              </span>
              <span className="text-border">|</span>
            </>
          )}
          {staticData?.runMetadata?.environment?.deno && (
            <span>Deno {staticData.runMetadata.environment.deno}</span>
          )}

          {/* Connection status */}
          <div
            className={cn(
              "flex items-center gap-1.5",
              wsConnected ? "text-green-500" : "text-muted-foreground"
            )}
          >
            {wsConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span>Live</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>{wsError || "Connecting..."}</span>
              </>
            )}
          </div>
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
