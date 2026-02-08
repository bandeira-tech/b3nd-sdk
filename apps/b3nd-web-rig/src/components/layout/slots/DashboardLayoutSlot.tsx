import { useEffect, useState, useCallback } from "react";
import { Activity, Loader2, AlertCircle, RefreshCw, Wifi, WifiOff, GitBranch, Settings } from "lucide-react";
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
    inspectorBasePath,
    availableBasePaths,
    setInspectorBasePath,
    refreshAvailableBasePaths,
    b3ndUrl,
    setB3ndUrl,
    inspectorPort,
    setInspectorPort,
  } = useDashboardStore();

  const [showSettings, setShowSettings] = useState(false);
  const [editBasePath, setEditBasePath] = useState(inspectorBasePath);
  const [editB3ndUrl, setEditB3ndUrl] = useState(b3ndUrl);
  const [editPort, setEditPort] = useState(String(inspectorPort));

  // Establish WebSocket connection for live streaming updates
  useDashboardWs();

  // Load data and discover available branches
  useEffect(() => {
    loadStaticData();
    refreshAvailableBasePaths();
  }, [loadStaticData, refreshAvailableBasePaths]);

  const applySettings = useCallback(() => {
    if (editB3ndUrl !== b3ndUrl) setB3ndUrl(editB3ndUrl);
    if (Number(editPort) !== inspectorPort) setInspectorPort(Number(editPort));
    if (editBasePath !== inspectorBasePath) setInspectorBasePath(editBasePath);
    setShowSettings(false);
  }, [editB3ndUrl, editPort, editBasePath, b3ndUrl, inspectorPort, inspectorBasePath, setB3ndUrl, setInspectorPort, setInspectorBasePath]);

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

          {/* Branch selector */}
          <div className="flex items-center gap-1.5 ml-2">
            <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
            {availableBasePaths.length > 1 ? (
              <select
                value={inspectorBasePath}
                onChange={(e) => setInspectorBasePath(e.target.value)}
                className="text-xs bg-transparent border border-border rounded px-1.5 py-0.5 text-foreground"
              >
                {availableBasePaths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                {!availableBasePaths.includes(inspectorBasePath) && (
                  <option value={inspectorBasePath}>{inspectorBasePath}</option>
                )}
              </select>
            ) : (
              <span className="text-xs text-muted-foreground font-mono">
                {inspectorBasePath}
              </span>
            )}
          </div>
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

          {/* Data source indicator */}
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
            dataSource === "b3nd" ? "bg-blue-500/10 text-blue-500" :
            dataSource === "static" ? "bg-yellow-500/10 text-yellow-500" :
            "bg-green-500/10 text-green-500"
          )}>
            {dataSource}
          </span>

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

          {/* Settings button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Settings panel */}
      {showSettings && (
        <div className="px-4 py-3 border-b border-border bg-card/50 flex items-end gap-4 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">B3nd URL</span>
            <input
              type="text"
              value={editB3ndUrl}
              onChange={(e) => setEditB3ndUrl(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 font-mono w-56"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Inspector Port</span>
            <input
              type="number"
              value={editPort}
              onChange={(e) => setEditPort(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 font-mono w-20"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Base Path</span>
            <input
              type="text"
              value={editBasePath}
              onChange={(e) => setEditBasePath(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 font-mono w-32"
            />
          </label>
          <button
            onClick={applySettings}
            className="px-3 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            Apply
          </button>
        </div>
      )}

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
