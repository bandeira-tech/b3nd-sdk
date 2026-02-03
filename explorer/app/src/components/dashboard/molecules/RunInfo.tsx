import { RefreshCw, Clock, FileCode, Zap, Play } from "lucide-react";
import { cn } from "../../../utils";
import type { RunMetadata } from "../types";

interface RunInfoProps {
  isRunning: boolean;
  runMetadata: { current: RunMetadata | null; last: RunMetadata | null };
  onManualRun: () => void;
  onCancel: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

function getTriggerLabel(trigger: string): { label: string; icon: typeof Clock } {
  switch (trigger) {
    case "startup":
      return { label: "Server startup", icon: Play };
    case "file-change":
      return { label: "File change", icon: FileCode };
    case "manual":
      return { label: "Manual run", icon: RefreshCw };
    default:
      return { label: trigger, icon: Clock };
  }
}

export function RunInfo({ isRunning, runMetadata, onManualRun, onCancel }: RunInfoProps) {
  const { current, last } = runMetadata;
  
  if (isRunning && current) {
    const { label, icon: Icon } = getTriggerLabel(current.trigger);
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <div className="flex items-center gap-1.5 text-blue-500">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="font-medium">Running</span>
          </div>
          <span className="text-muted-foreground">•</span>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </div>
          {current.changedFiles && current.changedFiles.length > 0 && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">
                {current.changedFiles.length} file(s)
              </span>
            </>
          )}
        </div>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (last) {
    const { label, icon: Icon } = getTriggerLabel(last.trigger);
    const completedAt = last.completedAt || last.startedAt;
    
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>Last run {formatRelativeTime(completedAt)}</span>
          </div>
          <span className="text-muted-foreground">•</span>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </div>
        </div>
        <button
          onClick={onManualRun}
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors",
            "text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
          title="Trigger manual re-run"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Re-run</span>
        </button>
      </div>
    );
  }

  // No run data yet
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="w-4 h-4" />
        <span>Waiting for test run...</span>
      </div>
      <button
        onClick={onManualRun}
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors",
          "bg-primary/10 text-primary hover:bg-primary/20"
        )}
      >
        <Zap className="w-3.5 h-3.5" />
        <span>Run now</span>
      </button>
    </div>
  );
}
