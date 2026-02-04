import { useState } from "react";
import { ChevronRight, ChevronDown, Clock } from "lucide-react";
import { cn } from "../../../utils";
import { StatusBadge } from "../atoms/StatusBadge";
import type { TestResult } from "../types";

interface TestRowProps {
  result: TestResult;
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return new Date(timestamp).toLocaleDateString();
}

export function TestRow({ result }: TestRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasError = result.error && result.status === "failed";

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 hover:bg-accent/50 cursor-pointer transition-colors",
          result.status === "failed" && "bg-red-500/5"
        )}
        onClick={() => hasError && setExpanded(!expanded)}
      >
        {hasError ? (
          <button className="p-0.5 hover:bg-accent rounded">
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <StatusBadge status={result.status} />

        <span className="flex-1 text-sm truncate" title={result.name}>
          {result.name}
        </span>

        <span className="text-xs text-muted-foreground font-mono">
          {result.file}
        </span>

        {result.duration !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {result.duration}ms
          </span>
        )}

        {result.lastRun && (
          <span
            className="flex items-center gap-0.5 text-xs text-muted-foreground/70"
            title={new Date(result.lastRun).toLocaleString()}
          >
            <Clock className="w-3 h-3" />
            {formatRelativeTime(result.lastRun)}
          </span>
        )}
      </div>

      {expanded && hasError && (
        <div className="px-3 py-2 bg-red-500/5 border-t border-border/50">
          <div className="text-sm font-medium text-red-500 mb-1">
            {result.error!.message}
          </div>
          {result.error!.stack && (
            <pre className="text-xs text-muted-foreground overflow-x-auto p-2 bg-background/50 rounded font-mono">
              {result.error!.stack}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
