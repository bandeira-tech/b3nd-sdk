// React import not needed with react-jsx runtime
import { useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { Terminal, Activity, Bug, X, ChevronUp, Clock } from 'lucide-react';

export function BottomPanel() {
  const { togglePanel } = useAppStore();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between bg-muted/30">
        <div className="flex items-center space-x-4">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Tools & Logs
          </h2>
          <div className="flex space-x-1">
            <TabButton active icon={<Terminal className="h-3 w-3" />} label="Console" />
            <TabButton icon={<Activity className="h-3 w-3" />} label="Network" />
            <TabButton icon={<Bug className="h-3 w-3" />} label="Debug" />
          </div>
        </div>

        <div className="flex items-center space-x-1">
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
        <ConsoleView />
      </div>
    </div>
  );
}

function TabButton({
  active = false,
  icon,
  label
}: {
  active?: boolean;
  icon: import('react').ReactNode;
  label: string;
}) {
  return (
    <button
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

function ConsoleView() {
  const logs = useAppStore((state) => state.logs);
  const clearLogs = useAppStore((state) => state.clearLogs);

  const sortedLogs = useMemo(() => [...logs].sort((a, b) => a.timestamp - b.timestamp), [logs]);

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

      <div className="mt-4 pt-2 border-t border-border/50 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-muted-foreground">
          <Terminal className="h-4 w-4" />
          <span className="text-xs">Console ready</span>
        </div>
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
