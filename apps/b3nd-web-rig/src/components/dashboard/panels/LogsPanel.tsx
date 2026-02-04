import { useEffect, useRef, useCallback } from "react";
import { RefreshCw, ExternalLink, Check, X, SkipForward, Loader2, Clock } from "lucide-react";
import { useDashboardStore } from "../stores/dashboardStore";
import { cn } from "../../../utils";

const DASHBOARD_API = "http://localhost:5556";

// Strip ANSI escape codes for parsing, keep for display
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

// Parse test output lines
const FILE_HEADER = /^running \d+ tests? from (.+\.test\.ts)/;
const TEST_RESULT = /^(.+?)\s+\.\.\.+\s+(ok|FAILED|ignored)\s*(?:\((\d+)(ms|s)?\))?/;
const SUMMARY_LINE = /^(ok|FAILED)\s*\|\s*(\d+)\s+passed\s*\|\s*(\d+)\s+failed/;

interface ParsedLine {
  type: "file-header" | "test-result" | "summary" | "text";
  raw: string;
  clean: string;
  // file-header
  filePath?: string;
  // test-result
  testName?: string;
  status?: "passed" | "failed" | "skipped";
  duration?: string;
  // summary
  passed?: number;
  failed?: number;
}

function parseLine(raw: string): ParsedLine {
  const clean = raw.replace(ANSI_PATTERN, "").trim();
  if (!clean) return { type: "text", raw, clean };

  const fileMatch = clean.match(FILE_HEADER);
  if (fileMatch) {
    return { type: "file-header", raw, clean, filePath: fileMatch[1] };
  }

  const resultMatch = clean.match(TEST_RESULT);
  if (resultMatch) {
    const [, name, result, dur, unit] = resultMatch;
    let duration = dur;
    if (dur && unit === "s") duration = `${parseInt(dur, 10) * 1000}`;
    return {
      type: "test-result",
      raw,
      clean,
      testName: name.trim(),
      status: result === "ok" ? "passed" : result === "FAILED" ? "failed" : "skipped",
      duration: duration ? `${duration}ms` : undefined,
    };
  }

  const summaryMatch = clean.match(SUMMARY_LINE);
  if (summaryMatch) {
    return {
      type: "summary",
      raw,
      clean,
      passed: parseInt(summaryMatch[2], 10),
      failed: parseInt(summaryMatch[3], 10),
    };
  }

  return { type: "text", raw, clean };
}

const statusConfig = {
  passed: { icon: Check, color: "text-green-500", bg: "bg-green-500/8" },
  failed: { icon: X, color: "text-red-500", bg: "bg-red-500/8" },
  skipped: { icon: SkipForward, color: "text-yellow-500", bg: "bg-yellow-500/8" },
};

export function LogsPanel() {
  const {
    logLines,
    logLoading,
    setLogLines,
    setLogLoading,
    runMetadata,
    testResults,
    navigateToSource,
  } = useDashboardStore();

  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    setLogLoading(true);
    try {
      const res = await fetch(`${DASHBOARD_API}/state/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogLines(data.lines || []);
      }
    } catch (e) {
      console.error("Failed to fetch logs:", e);
    } finally {
      setLogLoading(false);
    }
  }, [setLogLines, setLogLoading]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Re-fetch when a run completes
  const lastRun = runMetadata.last?.completedAt;
  useEffect(() => {
    if (lastRun) fetchLogs();
  }, [lastRun, fetchLogs]);

  // Find the file path for a test name by looking at test results
  const findFilePath = useCallback(
    (testName: string): string | null => {
      for (const result of testResults.values()) {
        if (result.name === testName && result.filePath) {
          return result.filePath;
        }
      }
      return null;
    },
    [testResults]
  );

  const parsed = logLines.map(parseLine);

  // Group lines by file
  let currentFile: string | null = null;
  const groups: { file: string | null; lines: ParsedLine[] }[] = [];

  for (const line of parsed) {
    if (line.type === "file-header") {
      currentFile = line.filePath || null;
      groups.push({ file: currentFile, lines: [line] });
    } else if (line.type === "summary") {
      groups.push({ file: null, lines: [line] });
    } else if (groups.length > 0) {
      groups[groups.length - 1].lines.push(line);
    } else {
      groups.push({ file: null, lines: [line] });
    }
  }

  const meta = runMetadata.last || runMetadata.current;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-sm">Test Run Output</h2>
          {meta && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {meta.completedAt
                ? new Date(meta.completedAt).toLocaleTimeString()
                : "running..."}
            </span>
          )}
        </div>
        <button
          onClick={fetchLogs}
          disabled={logLoading}
          className={cn(
            "p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground",
            logLoading && "animate-spin"
          )}
          title="Refresh logs"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Log content */}
      <div ref={scrollRef} className="flex-1 overflow-auto custom-scrollbar">
        {logLoading && logLines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading logs...
          </div>
        ) : logLines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No test output yet. Logs appear after a test run completes.
          </div>
        ) : (
          <div className="py-2">
            {groups.map((group, gi) => (
              <div key={gi} className="mb-1">
                {group.lines.map((line, li) => {
                  if (line.type === "file-header") {
                    return (
                      <div
                        key={li}
                        className="flex items-center gap-2 px-4 py-2 bg-muted/40 border-y border-border/30 sticky top-0 z-10"
                      >
                        <span className="text-xs font-mono font-medium text-foreground">
                          {line.filePath}
                        </span>
                        <button
                          onClick={() => {
                            // Find the absolute path from test results
                            const result = Array.from(testResults.values()).find(
                              (r) => line.filePath && r.filePath.endsWith(line.filePath.replace(/^\.\//, ""))
                            );
                            if (result?.filePath) {
                              navigateToSource(result.filePath);
                            }
                          }}
                          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
                          title="View source"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  }

                  if (line.type === "test-result") {
                    const config = statusConfig[line.status || "passed"];
                    const Icon = config.icon;
                    const filePath = findFilePath(line.testName || "");

                    return (
                      <div
                        key={li}
                        className={cn(
                          "group flex items-center gap-2 px-4 py-1 text-sm transition-colors",
                          "hover:bg-accent/40",
                          line.status === "failed" && "bg-red-500/5"
                        )}
                      >
                        <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", config.color)} />
                        <span
                          className={cn(
                            "flex-1 font-mono text-xs",
                            filePath && "cursor-pointer hover:text-primary hover:underline decoration-primary/40"
                          )}
                          onClick={() => {
                            if (filePath) {
                              navigateToSource(filePath, line.testName);
                            }
                          }}
                          title={filePath ? "Click to view test source" : undefined}
                        >
                          {line.testName}
                        </span>
                        {line.duration && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {line.duration}
                          </span>
                        )}
                        {filePath && (
                          <ExternalLink className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                        )}
                      </div>
                    );
                  }

                  if (line.type === "summary") {
                    const isOk = (line.failed || 0) === 0;
                    return (
                      <div
                        key={li}
                        className={cn(
                          "mx-4 my-2 px-3 py-2 rounded-md text-xs font-mono font-medium border",
                          isOk
                            ? "bg-green-500/8 border-green-500/20 text-green-600 dark:text-green-400"
                            : "bg-red-500/8 border-red-500/20 text-red-600 dark:text-red-400"
                        )}
                      >
                        {line.clean}
                      </div>
                    );
                  }

                  // Plain text lines
                  if (!line.clean) return null;
                  return (
                    <div key={li} className="px-4 py-0.5 text-xs font-mono text-muted-foreground/70">
                      {line.clean}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
