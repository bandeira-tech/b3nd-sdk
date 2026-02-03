import { useRef, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { useDashboardStore } from "../stores/dashboardStore";
import { useState } from "react";

// Strip ANSI escape codes for clean display
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function RawLogsPanel() {
  const { rawLogs } = useDashboardStore();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const cleanLogs = rawLogs.replace(ANSI_PATTERN, "");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cleanLogs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const area = document.createElement("textarea");
      area.value = cleanLogs;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [cleanLogs]);

  if (!rawLogs) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        No test logs available. Run the build to generate logs.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-sm">Raw Test Output</h2>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-500" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-auto custom-scrollbar bg-muted/20">
        <pre
          ref={preRef}
          className="p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed text-foreground/80"
        >
          {cleanLogs}
        </pre>
      </div>
    </div>
  );
}
