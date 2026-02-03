import { Activity, Wifi, WifiOff, FileCode } from "lucide-react";
import { useDashboardStore } from "../../dashboard/stores/dashboardStore";
import { useDashboardWs } from "../../dashboard/hooks/useDashboardWs";
import { ResultsPanel } from "../../dashboard/panels/ResultsPanel";
import { LogsPanel } from "../../dashboard/panels/LogsPanel";
import { CodePanel } from "../../dashboard/panels/CodePanel";
import { HealthPanel } from "../../dashboard/panels/HealthPanel";
import { EducationPanel } from "../../dashboard/panels/EducationPanel";
import type { TestFilter } from "../../dashboard/types";
import { cn } from "../../../utils";

const DASHBOARD_API = "http://localhost:5556";

export function DashboardLayoutSlot() {
  const { wsConnected, wsError, recentChanges, dataSource, activeView } = useDashboardStore();

  // Initialize WebSocket connection - this loads state automatically on connect
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

  // Determine which main panel to render
  const renderMainPanel = () => {
    switch (activeView) {
      case "logs":
        return <LogsPanel />;
      case "code":
        return <CodePanel />;
      case "tests":
      default:
        return (
          <ResultsPanel
            onRunTests={handleRunTests}
            onCancelTests={handleCancelTests}
          />
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg">Developer Dashboard</h1>
        </div>

        <div className="flex items-center gap-4">
          {/* File change indicator (only in live mode) */}
          {isLive && recentChanges.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileCode className="w-4 h-4" />
              <span>{recentChanges[0].files.length} file(s) changed</span>
            </div>
          )}

          {/* Connection status (only in live mode) */}
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

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Center panel - switches based on activeView */}
        <div className="flex-1 overflow-hidden">
          {renderMainPanel()}
        </div>

        {/* Right panel - Health & Education (hide when viewing code for more space) */}
        {activeView !== "code" && (
          <div className="w-80 border-l border-border bg-card flex-shrink-0 overflow-auto custom-scrollbar">
            <HealthPanel />
            <div className="border-t border-border">
              <EducationPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
