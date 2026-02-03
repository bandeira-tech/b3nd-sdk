import { ListChecks, ScrollText, Code2, File, FolderOpen } from "lucide-react";
import { FacetPanel } from "../../dashboard/panels/FacetPanel";
import { useDashboardStore } from "../../dashboard/stores/dashboardStore";
import { cn } from "../../../utils";
import type { LeftPanelView } from "../../dashboard/types";
import { useMemo } from "react";

const navItems: { id: LeftPanelView; label: string; icon: typeof ListChecks }[] = [
  { id: "tests", label: "Tests", icon: ListChecks },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "code", label: "Code", icon: Code2 },
];

export function DashboardLeftSlot() {
  const {
    activeView,
    setActiveView,
    testResults,
    selectedSourceFile,
    navigateToSource,
  } = useDashboardStore();

  // Build file list for code navigation
  const testFiles = useMemo(() => {
    const files = new Map<string, { path: string; name: string; hasFailure: boolean }>();
    for (const result of testResults.values()) {
      if (!files.has(result.filePath)) {
        files.set(result.filePath, {
          path: result.filePath,
          name: result.file,
          hasFailure: result.status === "failed",
        });
      } else if (result.status === "failed") {
        files.get(result.filePath)!.hasFailure = true;
      }
    }
    return Array.from(files.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [testResults]);

  // Group files by parent directory
  const fileGroups = useMemo(() => {
    const groups = new Map<string, typeof testFiles>();
    for (const file of testFiles) {
      const parts = file.path.split("/");
      const dir = parts.slice(-2, -1)[0] || "sdk";
      const existing = groups.get(dir) || [];
      existing.push(file);
      groups.set(dir, existing);
    }
    return groups;
  }, [testFiles]);

  return (
    <div className="h-full flex flex-col">
      {/* Navigation tabs */}
      <div className="flex border-b border-border bg-card">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors relative",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
              {isActive && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Panel content based on active view */}
      {activeView === "tests" && <FacetPanel />}

      {activeView === "logs" && (
        <div className="flex-1 overflow-auto custom-scrollbar">
          <div className="p-4">
            <p className="text-xs text-muted-foreground">
              Raw test output from the last run. Click any test name to view its source implementation.
            </p>
          </div>
        </div>
      )}

      {activeView === "code" && (
        <div className="flex-1 overflow-auto custom-scrollbar">
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground">
              Browse test implementations
            </p>
          </div>
          {testFiles.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center">
              No test files discovered yet
            </div>
          ) : (
            <div className="py-1">
              {Array.from(fileGroups.entries()).map(([dir, files]) => (
                <div key={dir}>
                  <div className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                    <FolderOpen className="w-3 h-3" />
                    {dir}/
                  </div>
                  {files.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => navigateToSource(file.path)}
                      className={cn(
                        "w-full flex items-center gap-2 pl-7 pr-4 py-1.5 text-xs font-mono transition-colors",
                        "hover:bg-accent/50",
                        selectedSourceFile === file.path
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground"
                      )}
                    >
                      <File
                        className={cn(
                          "w-3 h-3 flex-shrink-0",
                          file.hasFailure
                            ? "text-red-500"
                            : selectedSourceFile === file.path
                              ? "text-primary"
                              : "text-muted-foreground"
                        )}
                      />
                      <span className="truncate">{file.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
