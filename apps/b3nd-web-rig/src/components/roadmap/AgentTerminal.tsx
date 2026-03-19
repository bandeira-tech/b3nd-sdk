/**
 * Shared terminal output components for agent relay sessions.
 * Used in both the story detail view (inline) and the bottom panel activity feed.
 */
import { useMemo, useRef, useEffect, useState } from "react";
import {
  Loader2, ChevronDown, Terminal, CheckCircle, XCircle,
} from "lucide-react";
import { cn } from "../../utils";
import type { AgentSession } from "./useAgentRelay";

/* -- Stream-JSON Parser --------------------------------------------------- */

export function parseStreamJson(lines: string[]): string[] {
  return lines.map((line) => {
    try {
      const obj = JSON.parse(line);

      // Skip init/system messages
      if (obj.type === "system") return null;

      // Assistant message: extract text from content blocks
      if (obj.type === "assistant" && obj.message?.content) {
        const texts = (obj.message.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text);
        return texts.length > 0 ? texts.join("") : null;
      }

      // Tool use from verbose mode
      if (obj.type === "tool_use") {
        const name = obj.name ?? obj.tool_name ?? "tool";
        return `[tool] ${name}`;
      }
      if (obj.type === "tool_result") {
        return null;
      }

      // Final result
      if (obj.type === "result" && typeof obj.result === "string") {
        return obj.result;
      }

      return line;
    } catch {
      return line;
    }
  }).filter((l): l is string => l !== null);
}

/* -- Terminal Output ------------------------------------------------------ */

export function TerminalOutput({
  lines,
  running,
  maxHeight,
}: {
  lines: string[];
  running: boolean;
  maxHeight?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  const parsedLines = useMemo(() => parseStreamJson(lines), [lines]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 relative rounded-b-lg">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-xs bg-zinc-950 text-zinc-300 p-3 custom-scrollbar"
        style={maxHeight ? { maxHeight } : undefined}
      >
        {parsedLines.length === 0 && running && (
          <div className="text-zinc-500 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Waiting for output...
          </div>
        )}
        {parsedLines.map((line, i) => (
          <div key={i} className="leading-5 whitespace-pre-wrap break-words">
            {line}
          </div>
        ))}
        {running && (
          <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
        )}
      </div>

      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            containerRef.current?.scrollTo({
              top: containerRef.current.scrollHeight,
              behavior: "smooth",
            });
          }}
          className="absolute bottom-3 right-5 p-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/* -- Elapsed Time --------------------------------------------------------- */

export function ElapsedTime({ startedAt, running }: { startedAt: number; running: boolean }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = Math.floor(((running ? now : Date.now()) - startedAt) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return (
    <span className="text-[10px] text-muted-foreground font-mono">
      {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
    </span>
  );
}

/* -- Session Status Icon -------------------------------------------------- */

export function SessionStatusIcon({ session }: { session: AgentSession }) {
  switch (session.status) {
    case "running":
      return <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />;
    case "complete":
      return <CheckCircle className="w-3 h-3 text-green-400" />;
    case "error":
      return <XCircle className="w-3 h-3 text-red-400" />;
    case "cancelled":
      return <XCircle className="w-3 h-3 text-orange-400" />;
    default:
      return <Terminal className="w-3 h-3 text-muted-foreground" />;
  }
}

/* -- Session Status Label ------------------------------------------------- */

export function sessionStatusLabel(session: AgentSession): string {
  switch (session.status) {
    case "running": return "Running";
    case "complete": return session.exitCode === 0 ? "Completed" : `Failed (exit ${session.exitCode})`;
    case "error": return `Error (exit ${session.exitCode ?? "?"})`;
    case "cancelled": return "Cancelled";
    default: return session.status;
  }
}

/* -- Output Line Count ---------------------------------------------------- */

export function outputLineCount(lines: string[]): number {
  return parseStreamJson(lines).length;
}
