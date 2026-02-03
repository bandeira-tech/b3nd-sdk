import { Play, Square, RotateCcw, Zap, Filter } from "lucide-react";
import { cn } from "../../../utils";

interface RunControlsProps {
  isRunning: boolean;
  autoRunEnabled: boolean;
  onRunAll: () => void;
  onCancel: () => void;
  onClear: () => void;
  onToggleAutoRun: () => void;
  hasFilter?: boolean;
}

export function RunControls({
  isRunning,
  autoRunEnabled,
  onRunAll,
  onCancel,
  onClear,
  onToggleAutoRun,
  hasFilter = false,
}: RunControlsProps) {
  return (
    <div className="flex items-center gap-2">
      {isRunning ? (
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-md text-sm font-medium transition-colors"
        >
          <Square className="w-4 h-4" />
          Stop
        </button>
      ) : (
        <button
          onClick={onRunAll}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            hasFilter
              ? "bg-blue-500 hover:bg-blue-600 text-white"
              : "bg-primary hover:bg-primary/90 text-primary-foreground"
          )}
        >
          {hasFilter ? <Filter className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {hasFilter ? "Run Filtered" : "Run All"}
        </button>
      )}

      <button
        onClick={onClear}
        className="p-1.5 hover:bg-accent rounded-md text-muted-foreground hover:text-foreground transition-colors"
        title="Clear results"
      >
        <RotateCcw className="w-4 h-4" />
      </button>

      <div className="h-4 w-px bg-border" />

      <button
        onClick={onToggleAutoRun}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors",
          autoRunEnabled
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
        title={autoRunEnabled ? "Disable auto-run on file changes" : "Enable auto-run on file changes"}
      >
        <Zap className={cn("w-4 h-4", autoRunEnabled && "fill-current")} />
        <span className="hidden sm:inline">Auto</span>
      </button>
    </div>
  );
}
