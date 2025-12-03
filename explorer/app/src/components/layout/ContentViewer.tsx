import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAppStore } from "../../stores/appStore";
import { routeForExplorerPath } from "../../utils";
import { useActiveBackend } from "../../stores/appStore";
import type {
  PersistenceRecord,
  NavigationNode,
  PaginatedResponse,
} from "../../types";
import {
  Copy,
  Download,
  Calendar,
  ChevronDown,
  ChevronRight,
  Folder,
  FileText,
  Link as LinkIcon,
} from "lucide-react";
import { HttpAdapter } from "../../adapters/HttpAdapter";
// no extra utils used here

interface ContentViewerProps {
  path: string;
}

export function ContentViewer({ path }: ContentViewerProps) {
  const [record, setRecord] = useState<PersistenceRecord | null>(null);
  const [directoryContents, setDirectoryContents] = useState<NavigationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeBackend = useActiveBackend();
  const { mode, rootNodes } = useAppStore();

  const loadContent = useCallback(async () => {
    console.log(
      "ContentViewer loadContent called for path:",
      path,
      "mode:",
      mode,
    ); // Debug
    if (!activeBackend?.adapter || mode !== "filesystem") {
      console.log("ContentViewer: skipping load - no adapter or wrong mode"); // Debug
      setLoading(false);
      setError("No backend available");
      setRecord(null);
      setDirectoryContents([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setRecord(null);
      setDirectoryContents([]);

      // Handle root path specially - use schema-driven rootNodes
      if (path === "/" || path === "") {
        console.log("ContentViewer: showing root nodes from schema:", rootNodes); // Debug
        setDirectoryContents(rootNodes);
        setLoading(false);
        return;
      }

      console.log("ContentViewer: loading list for path:", path); // Debug
      const listResponse: PaginatedResponse<NavigationNode> = await activeBackend.adapter.listPath(path, { page: 1, limit: 50 });
      console.log("ContentViewer: listResponse for", path, "data length:", listResponse.data.length); // Debug

      // Detection logic: if listPath returns empty data (length === 0), it's a file - call readRecord
      if (listResponse.data.length === 0) {
        console.log(
          "ContentViewer: detected file (empty list), loading record for",
          path,
        ); // Debug
        const fileRecord: PersistenceRecord =
          await activeBackend.adapter.readRecord(path);
        setRecord(fileRecord);
        console.log("ContentViewer: file record loaded:", fileRecord); // Debug
      } else {
        // Otherwise, it's a directory - show contents
        console.log(
          "ContentViewer: detected directory with",
          listResponse.data.length,
          "items",
        ); // Debug
        setDirectoryContents(listResponse.data);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(`Failed to load content: ${errorMsg}`);
      console.error("ContentViewer load error:", err); // Debug
    } finally {
      setLoading(false);
    }
  }, [path, activeBackend, mode, rootNodes]); // Stable callback with deps

  useEffect(() => {
    console.log("ContentViewer useEffect triggered for path:", path); // Debug
    loadContent();
  }, [loadContent]); // Depend on callback (re-runs when path changes)

  const copyToClipboard = async () => {
    if (!record) {
      throw new Error("No record loaded to copy");
    }

    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      throw new Error("Clipboard API is not available in this browser");
    }

    const jsonString = JSON.stringify(record.data, null, 2);
    await navigator.clipboard.writeText(jsonString);
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Loading content...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">Error: {error}</div>
    );
  }

  if (record) {
    const readUrl =
      activeBackend?.adapter instanceof HttpAdapter
        ? activeBackend.adapter.getReadUrl(path)
        : undefined;
    return (
      <FileViewer record={record} onCopy={copyToClipboard} readUrl={readUrl} />
    );
  }

  if (directoryContents.length > 0) {
    return <DirectoryViewer contents={directoryContents} />;
  }

  return (
    <div className="p-4 text-center text-muted-foreground">
      No content at this path
    </div>
  );
}

function FileViewer({
  record,
  onCopy,
  readUrl,
}: {
  record: PersistenceRecord;
  onCopy: () => Promise<void>;
  readUrl?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [copyError, setCopyError] = useState<string | null>(null);

  const handleCopyClick = async () => {
    try {
      setCopyError(null);
      await onCopy();
      setCopyState("success");
      setTimeout(() => {
        setCopyState("idle");
      }, 2000);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to copy JSON";
      setCopyError(message);
      setCopyState("error");
      setTimeout(() => {
        setCopyState("idle");
        setCopyError(null);
      }, 4000);
    }
  };

  const handleDownloadClick = () => {
    try {
      const jsonString = JSON.stringify(record.data, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "record.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to download JSON";
      setCopyError(message);
      setCopyState("error");
      setTimeout(() => {
        setCopyState("idle");
        setCopyError(null);
      }, 4000);
    }
  };

  const formatData = (data: any, level = 0): ReactNode => {
    if (data === null || data === undefined)
      return <span className="json-null">null</span>;
    if (typeof data === "string")
      return <span className="json-string">"{data}"</span>;
    if (typeof data === "number")
      return <span className="json-number">{data}</span>;
    if (typeof data === "boolean")
      return <span className="json-boolean">{String(data)}</span>;
    if (Array.isArray(data)) {
      return (
        <div className="ml-4">
          [<br />
          {data.map((item, i) => (
            <div key={`arr-${level}-${i}`} style={{ paddingLeft: `${level * 2 + 1}rem` }}>
              {formatData(item, level + 1)}
              {i < data.length - 1 && ","}
            </div>
          ))}
          <br />]
        </div>
      );
    }
    if (typeof data === "object" && data !== null) {
      return (
        <div className="ml-4">
          {Object.entries(data).map(([k, v]) => {
            const key = `obj-${level}-${k}`;
            return (
              <div key={key} style={{ paddingLeft: `${level * 2 + 1}rem` }}>
                <span className="json-key">"{k}"</span>:{" "}
                {formatData(v, level + 1)}
              </div>
            );
          })}
        </div>
      );
    }
    return <span>{String(data)}</span>;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center space-x-2">
          <FileText className="h-5 w-5" />
          <span>Record Data</span>
        </h3>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleCopyClick}
            className="p-2 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            title="Copy JSON"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={handleDownloadClick}
            className="p-2 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </button>
          {readUrl && (
            <a
              href={readUrl}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
              title="Open API URL"
            >
              <LinkIcon className="h-4 w-4" />
            </a>
          )}
          {copyState === "success" && (
            <span className="text-xs text-emerald-600">Copied</span>
          )}
          {copyState === "error" && copyError && (
            <span className="text-xs text-destructive">
              {copyError}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center space-x-2 text-sm text-muted-foreground mb-2">
        <Calendar className="h-4 w-4" />
        <span>Modified: {new Date(record.ts).toLocaleString()}</span>
      </div>
      <pre className="bg-muted rounded p-4 overflow-auto max-h-96 custom-scrollbar font-mono text-sm">
        <div className="flex items-center space-x-2 mb-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <span className="json-key">data</span>:
        </div>
        {expanded && formatData(record.data)}
      </pre>
    </div>
  );
}

function DirectoryViewer({ contents }: { contents: NavigationNode[] }) {
  const navigate = useNavigate();

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-semibold flex items-center space-x-2">
        <Folder className="h-5 w-5" />
        <span>Directory Contents ({contents.length} items)</span>
      </h3>
      <div className="space-y-2">
        {contents.map((item) => (
          <div
            key={item.path}
            className="flex items-center space-x-3 p-3 rounded-lg hover:bg-accent cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            onClick={() => {
              console.log("DirectoryViewer clicked item:", item.path); // Debug
              navigate(routeForExplorerPath(item.path));
            }}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate(routeForExplorerPath(item.path));
              }
            }}
          >
            <div className="flex-shrink-0">
              {item.type === "directory" ? (
                <Folder className="h-5 w-5 text-blue-500" />
              ) : (
                <FileText className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{item.name}</div>
              {item.record && (
                <div className="text-sm text-muted-foreground">
                  Modified: {new Date(item.record.ts).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
