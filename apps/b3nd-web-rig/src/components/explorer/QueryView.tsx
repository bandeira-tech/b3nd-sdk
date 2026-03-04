import { useState } from "react";
import { useAppStore, useActiveBackend } from "../../stores/appStore";
import { cn } from "../../utils";
import {
  Play,
  Trash2,
  Clock,
  FileText,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Database,
  Copy,
} from "lucide-react";
import type { QueryRecord, QueryResult } from "../../types";

/**
 * QueryView — the query mode explorer panel.
 *
 * Provides a JSON editor for sending queries (native passthrough, portable DSL,
 * or stored query refs) to the active backend, and displays results.
 */
export function QueryView() {
  const {
    queryInput,
    queryResults,
    queryLoading,
    queryHistory,
    setQueryInput,
    executeQuery,
    clearQueryResults,
  } = useAppStore();
  const activeBackend = useActiveBackend();
  const [showHistory, setShowHistory] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryInput.trim() || queryLoading) return;
    executeQuery();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter to execute
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (queryInput.trim() && !queryLoading) {
        executeQuery();
      }
    }
  };

  return (
    <div className="p-4 space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Database className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Query</h3>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {showHelp ? "Hide Help" : "Help"}
          </button>
          {queryHistory.length > 0 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center space-x-1"
            >
              <Clock className="h-3 w-3" />
              <span>History</span>
            </button>
          )}
        </div>
      </div>

      {/* Help panel */}
      {showHelp && <QueryHelp />}

      {/* History dropdown */}
      {showHistory && queryHistory.length > 0 && (
        <div className="border border-border rounded-lg bg-card p-2 space-y-1 max-h-48 overflow-auto custom-scrollbar">
          <div className="text-xs text-muted-foreground uppercase tracking-wide px-2 py-1">
            Recent queries
          </div>
          {queryHistory.map((item, i) => (
            <button
              key={i}
              onClick={() => {
                setQueryInput(item);
                setShowHistory(false);
              }}
              className="w-full text-left px-2 py-1.5 rounded text-sm font-mono text-muted-foreground hover:text-foreground hover:bg-accent transition-colors truncate"
            >
              {item.length > 80 ? item.slice(0, 80) + "..." : item}
            </button>
          ))}
        </div>
      )}

      {/* Query input */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Query JSON
        </label>
        <textarea
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDER}
          rows={8}
          className="w-full p-3 border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm resize-y"
          disabled={queryLoading}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {activeBackend ? `Backend: ${activeBackend.name}` : "No backend selected"}
          </span>
          <div className="flex items-center space-x-2">
            {queryResults && (
              <button
                type="button"
                onClick={clearQueryResults}
                className="p-2 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                title="Clear results"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={!queryInput.trim() || queryLoading || !activeBackend}
              className={cn(
                "flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                queryInput.trim() && !queryLoading && activeBackend
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            >
              <Play className="h-4 w-4" />
              <span>{queryLoading ? "Running..." : "Execute"}</span>
            </button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Ctrl+Enter to execute
        </div>
      </form>

      {/* Results */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {queryLoading && (
          <div className="text-center py-8 text-muted-foreground">
            Running query...
          </div>
        )}
        {queryResults && !queryLoading && (
          <QueryResults result={queryResults} />
        )}
      </div>
    </div>
  );
}

function QueryHelp() {
  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-3 text-sm">
      <div className="font-semibold">Query Modes</div>

      <div className="space-y-2">
        <div>
          <div className="font-medium text-xs text-muted-foreground uppercase">Native Passthrough</div>
          <pre className="bg-muted rounded p-2 text-xs font-mono mt-1 overflow-auto">
{`{
  "native": {
    "sql": "uri LIKE $1 AND (data->>'age')::int > $2",
    "params": ["store://users/%", 25],
    "limit": 10
  }
}`}
          </pre>
        </div>

        <div>
          <div className="font-medium text-xs text-muted-foreground uppercase">Portable DSL</div>
          <pre className="bg-muted rounded p-2 text-xs font-mono mt-1 overflow-auto">
{`{
  "uri": "store://users",
  "where": { "field": "role", "op": "eq", "value": "admin" },
  "orderBy": [{ "field": "name", "direction": "asc" }],
  "limit": 20
}`}
          </pre>
        </div>

        <div>
          <div className="font-medium text-xs text-muted-foreground uppercase">Stored Query</div>
          <pre className="bg-muted rounded p-2 text-xs font-mono mt-1 overflow-auto">
{`{
  "ref": "mutable://queries/users-by-city",
  "args": { "city": "NYC" }
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}

function QueryResults({ result }: { result: QueryResult }) {
  if (!result.success) {
    return (
      <div className="border border-destructive/30 rounded-lg bg-destructive/5 p-4 space-y-2">
        <div className="flex items-center space-x-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span className="font-semibold">Query Error</span>
        </div>
        <pre className="text-sm text-destructive/80 font-mono whitespace-pre-wrap">
          {result.error}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {result.records.length} record{result.records.length !== 1 ? "s" : ""}
          {result.total !== undefined && result.total !== result.records.length && (
            <span> of {result.total} total</span>
          )}
        </div>
      </div>

      {result.records.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No records matched the query</p>
        </div>
      )}

      <div className="space-y-2">
        {result.records.map((record, i) => (
          <RecordCard key={`${record.uri}-${i}`} record={record} />
        ))}
      </div>
    </div>
  );
}

function RecordCard({ record }: { record: QueryRecord }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(record.data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center space-x-2 p-3 text-left hover:bg-accent/50 transition-colors"
      >
        {expanded
          ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        <span className="font-mono text-sm truncate flex-1">{record.uri}</span>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {new Date(record.ts).toLocaleString()}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border p-3 bg-muted/30">
          <div className="flex items-center justify-end mb-2">
            <button
              onClick={handleCopy}
              className="flex items-center space-x-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Copy className="h-3 w-3" />
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <pre className="text-sm font-mono overflow-auto max-h-64 custom-scrollbar whitespace-pre-wrap">
            {JSON.stringify(record.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

const PLACEHOLDER = `{
  "native": { ... }
}

or

{
  "uri": "store://...",
  "where": { "field": "...", "op": "eq", "value": "..." }
}`;
