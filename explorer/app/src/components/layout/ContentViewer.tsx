import React, { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../../stores/appStore";
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
} from "lucide-react";
import { cn } from "../../utils";

interface ContentViewerProps {
  path: string;
}

export function ContentViewer({ path }: ContentViewerProps) {
  const [record, setRecord] = useState<PersistenceRecord | null>(null);
  const [directoryContents, setDirectoryContents] = useState<NavigationNode[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeBackend = useActiveBackend();
  const { mode } = useAppStore();

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

      console.log("ContentViewer: loading list for path:", path); // Debug
      const listResponse: PaginatedResponse<NavigationNode> =
        await activeBackend.adapter.listPath(path, { page: 1, limit: 50 });
      console.log(
        "ContentViewer: listResponse for",
        path,
        "total:",
        listResponse.pagination.total,
        "data length:",
        listResponse.data.length,
        "first item type:",
        listResponse.data[0]?.type,
      ); // Debug

      if (
        listResponse.data.length === 1 &&
        listResponse.data[0].type === "file"
      ) {
        console.log(
          "ContentViewer: detected single file, loading record for",
          path,
        ); // Debug
        const fileRecord: PersistenceRecord =
          await activeBackend.adapter.readRecord(path);
        setRecord(fileRecord);
        console.log("ContentViewer: file record loaded:", fileRecord.data); // Debug
      } else {
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
  }, [path, activeBackend, mode]); // Stable callback with deps

  useEffect(() => {
    console.log("ContentViewer useEffect triggered for path:", path); // Debug
    loadContent();
  }, [loadContent]); // Depend on callback (re-runs when path changes)

  const copyToClipboard = () => {
    if (record) {
      const jsonString = JSON.stringify(record.data, null, 2);
      navigator.clipboard
        .writeText(jsonString)
        .then(() => console.log("Copied JSON")); // Debug
    }
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
    return <FileViewer record={record} onCopy={copyToClipboard} />;
  }

  if (directoryContents.length > 0) {
    return <DirectoryViewer contents={directoryContents} path={path} />;
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
}: {
  record: PersistenceRecord;
  onCopy: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const formatData = (data: any, level = 0): React.ReactNode => {
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
            <React.Fragment key={i}>
              <div style={{ paddingLeft: `${level * 2 + 1}rem` }}>
                {formatData(item, level + 1)}
              </div>
              {i < data.length - 1 && ","}
              <br />
            </React.Fragment>
          ))}
          <br />]
        </div>
      );
    }
    if (typeof data === "object") {
      return (
        <div className="ml-4">
          {Object.entries(data).map(([k, v]) => (
            <React.Fragment key={k}>
              <div style={{ paddingLeft: `${level * 2 + 1}rem` }}>
                <span className="json-key">"{k}"</span>:{" "}
                {formatData(v, level + 1)}
              </div>
              <br />
            </React.Fragment>
          ))}
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
        <div className="flex space-x-2">
          <button
            onClick={onCopy}
            className="p-2 rounded hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
            title="Copy JSON"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            className="p-2 rounded hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </button>
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

function DirectoryViewer({
  contents,
  path,
}: {
  contents: NavigationNode[];
  path: string;
}) {
  const { navigateToPath } = useAppStore();

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
              navigateToPath(item.path);
            }}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigateToPath(item.path);
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
