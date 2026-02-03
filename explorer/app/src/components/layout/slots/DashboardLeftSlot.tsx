import { ListChecks, ScrollText, Search } from "lucide-react";
import { FacetPanel } from "../../dashboard/panels/FacetPanel";
import { useDashboardStore } from "../../dashboard/stores/dashboardStore";
import { cn } from "../../../utils";
import type { ContentMode } from "../../dashboard/types";

const modeItems: { id: ContentMode; label: string; icon: typeof ListChecks }[] = [
  { id: "results", label: "Results", icon: Search },
  { id: "logs", label: "Test Logs", icon: ScrollText },
];

export function DashboardLeftSlot() {
  const { contentMode, setContentMode, runSummary } = useDashboardStore();

  return (
    <div className="h-full flex flex-col">
      {/* Content mode toggle */}
      <div className="p-3 border-b border-border bg-card">
        <div className="flex gap-1">
          {modeItems.map((item) => {
            const Icon = item.icon;
            const isActive = contentMode === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setContentMode(item.id)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary bar */}
      {runSummary && (
        <div className="px-3 py-2 border-b border-border text-xs flex items-center gap-2">
          <span className="text-green-500 font-medium">{runSummary.passed} passed</span>
          {runSummary.failed > 0 && (
            <span className="text-red-500 font-medium">{runSummary.failed} failed</span>
          )}
          {runSummary.skipped > 0 && (
            <span className="text-yellow-500">{runSummary.skipped} skipped</span>
          )}
          <span className="text-muted-foreground ml-auto">{runSummary.duration}ms</span>
        </div>
      )}

      {/* Filters (only in results mode) */}
      {contentMode === "results" && (
        <div className="flex-1 overflow-auto custom-scrollbar">
          <FacetPanel />
        </div>
      )}

      {/* Logs mode: no filters needed */}
      {contentMode === "logs" && (
        <div className="flex-1 overflow-auto custom-scrollbar p-4">
          <p className="text-xs text-muted-foreground">
            Raw terminal output from the last test run. This is the unfiltered
            text exactly as produced by the test runner.
          </p>
        </div>
      )}
    </div>
  );
}
