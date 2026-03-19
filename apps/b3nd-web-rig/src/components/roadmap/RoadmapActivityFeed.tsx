import { useMemo, useState } from "react";
import {
  Play, GitPullRequest, Zap, Clock, AlertCircle,
} from "lucide-react";
import { cn } from "../../utils";
import { useAppStore } from "../../stores/appStore";
import { useRoadmapStore } from "./useRoadmapStore";
import { useAgentRelayStore } from "./useAgentRelay";
import {
  TerminalOutput, ElapsedTime, SessionStatusIcon,
} from "./AgentTerminal";

export function RoadmapActivityFeed() {
  const logs = useAppStore((s) => s.logs);
  const openStory = useRoadmapStore((s) => s.openStory);
  const sessions = useAgentRelayStore((s) => s.sessions);
  const outputs = useAgentRelayStore((s) => s.outputs);

  const activeSessions = useMemo(() => {
    const list = [...sessions.values()];
    list.sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      return b.startedAt - a.startedAt;
    });
    return list;
  }, [sessions]);

  const hasActiveSessions = activeSessions.length > 0;

  const roadmapLogs = useMemo(
    () => logs
      .filter((l) => l.source === "roadmap")
      .sort((a, b) => b.timestamp - a.timestamp),
    [logs],
  );

  if (!hasActiveSessions && roadmapLogs.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
        <Play className="w-5 h-5" />
        <div>No roadmap activity yet.</div>
        <p className="text-[10px] text-muted-foreground/60 max-w-xs text-center">
          Dispatch an agent or copy a prompt from a story to see activity here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Agent session output */}
      {hasActiveSessions && (
        <AgentSessionsView
          sessions={activeSessions}
          outputs={outputs}
          openStory={openStory}
        />
      )}

      {/* Log entries */}
      {roadmapLogs.length > 0 && (
        <div className={cn("p-4 space-y-3", hasActiveSessions && "border-t border-border")}>
          <div className="flex items-center gap-2 text-muted-foreground uppercase tracking-wide text-xs font-semibold shrink-0">
            <Play className="h-3 w-3" />
            <span>Activity Log</span>
          </div>
          <div className="space-y-1">
            {roadmapLogs.map((log, i) => {
              const storyIdMatch = log.message.match(/\b(G\d+-[A-Z]\d+-\d{2})\b/);
              const storyId = storyIdMatch?.[1];

              const icon = log.level === "success"
                ? <Zap className="w-3 h-3 text-green-400" />
                : log.level === "error"
                ? <AlertCircle className="w-3 h-3 text-red-400" />
                : <GitPullRequest className="w-3 h-3 text-blue-400" />;

              return (
                <div
                  key={`${log.timestamp}-${i}`}
                  className="flex items-start gap-3 py-1.5 hover:bg-muted/30 rounded px-2 -mx-2"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0 w-16">
                    <Clock className="h-3 w-3" />
                    <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="shrink-0 mt-0.5">{icon}</div>
                  <div className="flex-1 min-w-0 text-sm">
                    <span className="text-foreground">{log.message}</span>
                    {storyId && (
                      <button
                        onClick={() => openStory(storyId)}
                        className="ml-2 text-[10px] font-mono text-primary hover:underline"
                      >
                        {storyId}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* -- Agent Sessions View (bottom panel) ----------------------------------- */

function AgentSessionsView({
  sessions,
  outputs,
  openStory,
}: {
  sessions: import("./useAgentRelay").AgentSession[];
  outputs: Map<string, string[]>;
  openStory: (id: string) => void;
}) {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const activeId = selectedSession ?? sessions[0]?.storyId ?? null;
  const activeSession = sessions.find((s) => s.storyId === activeId);
  const activeOutput = activeId ? outputs.get(activeId) ?? [] : [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {sessions.length > 1 && (
        <div className="flex items-center gap-1 px-3 pt-3 pb-1 shrink-0 overflow-x-auto">
          {sessions.map((s) => (
            <button
              key={s.storyId}
              onClick={() => setSelectedSession(s.storyId)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono transition-colors shrink-0",
                s.storyId === activeId
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              )}
            >
              <SessionStatusIcon session={s} />
              {s.storyId}
            </button>
          ))}
        </div>
      )}

      {activeSession && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex items-center gap-3 px-4 py-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <SessionStatusIcon session={activeSession} />
              <button
                onClick={() => openStory(activeSession.storyId)}
                className="text-xs font-mono text-primary hover:underline"
              >
                {activeSession.storyId}
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">{activeSession.branch}</span>
            <div className="ml-auto">
              <ElapsedTime startedAt={activeSession.startedAt} running={activeSession.status === "running"} />
            </div>
            {activeSession.exitCode !== undefined && (
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full font-mono",
                activeSession.exitCode === 0
                  ? "bg-green-500/15 text-green-400"
                  : "bg-red-500/15 text-red-400",
              )}>
                exit {activeSession.exitCode}
              </span>
            )}
          </div>
          <TerminalOutput lines={activeOutput} running={activeSession.status === "running"} />
        </div>
      )}
    </div>
  );
}
