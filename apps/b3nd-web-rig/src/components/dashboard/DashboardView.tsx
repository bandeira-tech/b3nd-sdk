/**
 * DashboardView - Standalone dashboard component
 *
 * Note: This is the standalone version. When using the AppLayout slot system,
 * use DashboardLeftSlot and DashboardLayoutSlot instead.
 */
import { Activity, Wifi, WifiOff, FileCode } from "lucide-react";
import { useDashboardStore } from "./stores/dashboardStore";
import { useDashboardWs } from "./hooks/useDashboardWs";
import { FacetPanel } from "./panels/FacetPanel";
import { ResultsPanel } from "./panels/ResultsPanel";
import { HealthPanel } from "./panels/HealthPanel";
import { EducationPanel } from "./panels/EducationPanel";
import type { TestFilter } from "./types";
import { cn } from "../../utils";

const DASHBOARD_API = "http://localhost:5556";

export function DashboardView() {
  const { wsConnected, wsError, recentChanges, dataSource } = useDashboardStore();

  // Initialize WebSocket connection
  useDashboardWs();

  // Run tests handler
  const handleRunTests = async (filter?: TestFilter) => {
    if (dataSource !== "live") return;

    try {
      const response = await fetch(`${DASHBOARD_API}/state/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter }),
      });

      if (!response.ok) {
        throw new Error("Failed to start test run");
      }
    } catch (e) {
      console.error("Failed to run tests:", e);
    }
  };

  // Cancel tests handler
  const handleCancelTests = async () => {
    try {
      await fetch(`${DASHBOARD_API}/state/cancel`, { method: "POST" });
    } catch (e) {
      console.error("Failed to cancel tests:", e);
    }
  };

  const isLive = dataSource === "live";

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg">Developer Dashboard</h1>
        </div>

        <div className="flex items-center gap-4">
          {/* File change indicator */}
          {isLive && recentChanges.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileCode className="w-4 h-4" />
              <span>{recentChanges[0].files.length} file(s) changed</span>
            </div>
          )}

          {/* Connection status */}
          {isLive && (
            <div
              className={cn(
                "flex items-center gap-1.5 text-xs",
                wsConnected ? "text-green-500" : "text-red-500"
              )}
            >
              {wsConnected ? (
                <>
                  <Wifi className="w-4 h-4" />
                  <span>Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4" />
                  <span>{wsError || "Disconnected"}</span>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main content - 3 panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel - Facet filters */}
        <div className="w-72 border-r border-border bg-card flex-shrink-0 overflow-hidden">
          <FacetPanel />
        </div>

        {/* Center panel - Results */}
        <div className="flex-1 overflow-hidden">
          <ResultsPanel
            onRunTests={handleRunTests}
            onCancelTests={handleCancelTests}
          />
        </div>

        {/* Right panel - Health & Education */}
        <div className="w-80 border-l border-border bg-card flex-shrink-0 overflow-auto custom-scrollbar">
          <HealthPanel />
          <div className="border-t border-border">
            <EducationPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
