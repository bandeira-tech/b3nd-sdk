// React import not needed with react-jsx runtime
import { useMemo, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import {
  Terminal,
  Activity,
  Bug,
  X,
  ChevronUp,
  Clock,
  KeyRound,
  Maximize2,
  Minimize2,
  Play,
} from "lucide-react";

export function BottomPanel() {
  const { togglePanel, bottomMaximized, toggleBottomPanelMaximized } = useAppStore();
  const [activeTab, setActiveTab] = useState<BottomTab>("output");

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between bg-muted/30">
        <div className="flex items-center space-x-4">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Tools & Logs
          </h2>
          <div className="flex space-x-1">
            <TabButton
              active={activeTab === "console"}
              onClick={() => setActiveTab("console")}
              icon={<Terminal className="h-3 w-3" />}
              label="Log"
            />
            <TabButton
              active={activeTab === "output"}
              onClick={() => setActiveTab("output")}
              icon={<Play className="h-3 w-3" />}
              label="Output"
            />
            <TabButton
              active={activeTab === "state"}
              onClick={() => setActiveTab("state")}
              icon={<KeyRound className="h-3 w-3" />}
              label="State"
            />
            <TabButton
              active={activeTab === "network"}
              onClick={() => setActiveTab("network")}
              icon={<Activity className="h-3 w-3" />}
              label="Network"
            />
            <TabButton
              active={activeTab === "debug"}
              onClick={() => setActiveTab("debug")}
              icon={<Bug className="h-3 w-3" />}
              label="Debug"
            />
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={toggleBottomPanelMaximized}
            className="p-1.5 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            title={bottomMaximized ? "Restore panel" : "Maximize panel"}
          >
            {bottomMaximized
              ? <Minimize2 className="h-4 w-4" />
              : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => togglePanel('bottom')}
            className="p-1.5 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            title="Minimize panel"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={() => togglePanel('bottom')}
            className="p-1.5 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            title="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto custom-scrollbar bg-background">
        {activeTab === "console" && <ConsoleView />}
        {activeTab === "output" && <WriterOutputView />}
        {activeTab === "state" && <WriterStateView />}
        {activeTab !== "console" && activeTab !== "output" && activeTab !== "state" && (
          <PlaceholderView label={activeTab === "network" ? "Network" : "Debug"} />
        )}
      </div>
    </div>
  );
}

type BottomTab = "console" | "output" | "state" | "network" | "debug";

function TabButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: import('react').ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center space-x-2 px-3 py-1.5 rounded text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function WriterStateView() {
  const {
    keyBundle,
    writerAppSession,
    writerSession,
    writerLastResolvedUri,
    writerLastAppUri,
    activeApp,
  } = useAppStore();

  if (activeApp !== "writer") {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Switch to the Writer experience to view app state.
      </div>
    );
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: "App Key", value: keyBundle.appKey },
    { label: "App Session", value: writerAppSession },
    { label: "User", value: writerSession?.username || "" },
    { label: "Authenticated", value: writerSession ? "yes" : "no" },
    { label: "Login Session (JWT)", value: writerSession?.token || "" },
    {
      label: "Expires In",
      value: writerSession?.expiresIn !== undefined
        ? String(writerSession.expiresIn)
        : "",
    },
    { label: "Last URI", value: writerLastResolvedUri || "" },
    { label: "Last App URI", value: writerLastAppUri || "" },
  ];

  return (
    <div className="p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground uppercase tracking-wide text-xs font-semibold">
        <KeyRound className="h-3 w-3" />
        <span>Current State</span>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {rows.map((row) => (
          <StateRow key={row.label} label={row.label} value={row.value} />
        ))}
      </div>
    </div>
  );
}

function WriterOutputView() {
  const { writerOutputs, activeApp } = useAppStore();

  if (activeApp !== "writer") {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Switch to the Writer experience to view output.
      </div>
    );
  }

  const entries = writerOutputs;

  return (
    <div className="h-full flex flex-col p-4 space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground uppercase tracking-wide text-xs font-semibold shrink-0">
        <Play className="h-3 w-3" />
        <span>Output</span>
      </div>
      {entries.length === 0
        ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            No output yet.
          </div>
        )
        : (
          <div className="flex-1 space-y-3 overflow-auto custom-scrollbar pr-1">
            {entries.map((entry) => {
              const inferredUri = resolveOutputUri(entry);
              return (
                <div
                  key={entry.id}
                  className="border border-border rounded-lg bg-muted/40 p-3 font-mono text-xs"
                >
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-2">
                    <span className="truncate" title={inferredUri || "No URI"}>
                      {inferredUri || "No URI"}
                    </span>
                    <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

function resolveOutputUri(entry: { uri?: string; data: unknown }) {
  if (entry.uri) return entry.uri;
  if (!entry.data || typeof entry.data !== "object") return undefined;
  const record = entry.data as Record<string, unknown>;
  return typeof record.uri === "string"
    ? record.uri
    : typeof record.resolvedUri === "string"
    ? record.resolvedUri
    : typeof record.targetUri === "string"
    ? record.targetUri
    : undefined;
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="rounded border border-border bg-muted/30 px-3 py-2 text-sm font-mono break-all min-h-[38px] flex items-center">
        {value || "—"}
      </div>
    </div>
  );
}

function PlaceholderView({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
      {label} tools coming soon.
    </div>
  );
}

function ConsoleView() {
  const logs = useAppStore((state) => state.logs);
  const clearLogs = useAppStore((state) => state.clearLogs);

  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => b.timestamp - a.timestamp),
    [logs],
  );

  return (
    <div className="p-4 font-mono text-sm space-y-3">
      {sortedLogs.length === 0 ? (
        <div className="text-center text-muted-foreground py-6">
          <Terminal className="h-5 w-5 mx-auto mb-2" />
          <div>No logs yet</div>
        </div>
      ) : (
        <div className="space-y-1">
          {sortedLogs.map((log, index) => (
            <LogEntry key={`${log.timestamp}-${index}`} log={log} />
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-border/50 flex justify-end">
        <button
          onClick={clearLogs}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
        >
          Clear logs
        </button>
      </div>
    </div>
  );
}

function LogEntry({ log }: { log: { timestamp: number; source: string; message: string; level?: string } }) {
  const getTypeColor = (type?: string) => {
    switch (type) {
      case 'success':
        return 'text-green-600 dark:text-green-400';
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-blue-600 dark:text-blue-400';
    }
  };

  const getTypeIcon = (type?: string) => {
    switch (type) {
      case 'success':
        return '✓';
      case 'warning':
        return '⚠';
      case 'error':
        return '✗';
      default:
        return 'ℹ';
    }
  };

  return (
    <div className="flex items-start space-x-3 py-1 hover:bg-muted/30 rounded px-2 -mx-2">
      <div className="flex items-center space-x-2 text-xs text-muted-foreground shrink-0 w-20">
        <Clock className="h-3 w-3" />
        <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
      </div>

      <div className={`shrink-0 w-4 text-center ${getTypeColor(log.level)}`}>
        {getTypeIcon(log.level)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">{log.source}</span>
          <span className={`text-foreground break-words ${getTypeColor(log.level)}`}>{log.message}</span>
        </div>
      </div>
    </div>
  );
}
