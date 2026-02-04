import { useEffect, useRef, useCallback, useMemo } from "react";
import { FileCode, Loader2, ChevronRight, FolderOpen, File, ArrowLeft } from "lucide-react";
import { useDashboardStore } from "../stores/dashboardStore";
import { cn } from "../../../utils";

const DASHBOARD_API = "http://localhost:5556";

// Simple TypeScript/JS keyword highlighting
const KEYWORDS = new Set([
  "import", "export", "from", "const", "let", "var", "function", "async", "await",
  "return", "if", "else", "for", "while", "class", "extends", "implements",
  "interface", "type", "enum", "new", "this", "super", "throw", "try", "catch",
  "finally", "typeof", "instanceof", "in", "of", "true", "false", "null", "undefined",
  "void", "never", "any", "string", "number", "boolean", "Promise", "default",
]);

function highlightLine(line: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    // String literals
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let end = i + 1;
      while (end < len && line[end] !== quote) {
        if (line[end] === "\\") end++; // skip escaped
        end++;
      }
      end = Math.min(end + 1, len);
      parts.push(
        <span key={i} className="text-green-600 dark:text-green-400">
          {line.slice(i, end)}
        </span>
      );
      i = end;
      continue;
    }

    // Line comments
    if (line[i] === "/" && line[i + 1] === "/") {
      parts.push(
        <span key={i} className="text-muted-foreground/60 italic">
          {line.slice(i)}
        </span>
      );
      break;
    }

    // Numbers
    if (/\d/.test(line[i]) && (i === 0 || !/\w/.test(line[i - 1]))) {
      let end = i;
      while (end < len && /[\d.xXa-fA-F]/.test(line[end])) end++;
      parts.push(
        <span key={i} className="text-amber-600 dark:text-amber-400">
          {line.slice(i, end)}
        </span>
      );
      i = end;
      continue;
    }

    // Words (keywords, identifiers)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let end = i;
      while (end < len && /[\w$]/.test(line[end])) end++;
      const word = line.slice(i, end);
      if (KEYWORDS.has(word)) {
        parts.push(
          <span key={i} className="text-purple-600 dark:text-purple-400 font-medium">
            {word}
          </span>
        );
      } else if (word[0] === word[0].toUpperCase() && /[a-z]/.test(word)) {
        // PascalCase = likely type/class
        parts.push(
          <span key={i} className="text-blue-600 dark:text-blue-400">
            {word}
          </span>
        );
      } else {
        parts.push(<span key={i}>{word}</span>);
      }
      i = end;
      continue;
    }

    // Operators and punctuation
    parts.push(<span key={i}>{line[i]}</span>);
    i++;
  }

  return parts;
}

export function CodePanel() {
  const {
    selectedSourceFile,
    sourceContent,
    sourceLoading,
    setSourceContent,
    setSourceLoading,
    highlightedTestName,
    testResults,
    navigateToSource,
    setActiveView,
  } = useDashboardStore();

  const codeRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Fetch source when file changes
  const fetchSource = useCallback(async (filePath: string) => {
    setSourceLoading(true);
    try {
      const res = await fetch(
        `${DASHBOARD_API}/state/source?file=${encodeURIComponent(filePath)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSourceContent(data);
      } else {
        setSourceContent(null);
      }
    } catch (e) {
      console.error("Failed to fetch source:", e);
      setSourceContent(null);
    } finally {
      setSourceLoading(false);
    }
  }, [setSourceContent, setSourceLoading]);

  useEffect(() => {
    if (selectedSourceFile) {
      fetchSource(selectedSourceFile);
    }
  }, [selectedSourceFile, fetchSource]);

  // Scroll to highlighted test name
  useEffect(() => {
    if (highlightedTestName && sourceContent && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [highlightedTestName, sourceContent]);

  // Get unique test files for the file browser
  const testFiles = useMemo(() => {
    const files = new Map<string, { path: string; name: string; status: string }>();
    for (const result of testResults.values()) {
      if (!files.has(result.filePath)) {
        files.set(result.filePath, {
          path: result.filePath,
          name: result.file,
          status: result.status,
        });
      } else {
        // If any test in the file failed, mark file as failed
        const existing = files.get(result.filePath)!;
        if (result.status === "failed") {
          existing.status = "failed";
        }
      }
    }
    return Array.from(files.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [testResults]);

  // Group files by directory
  const fileTree = useMemo(() => {
    const dirs = new Map<string, typeof testFiles>();
    for (const file of testFiles) {
      const parts = file.path.split("/");
      const dir = parts.slice(-2, -1)[0] || "sdk";
      const existing = dirs.get(dir) || [];
      existing.push(file);
      dirs.set(dir, existing);
    }
    return dirs;
  }, [testFiles]);

  const lines = sourceContent?.content.split("\n") || [];

  // Find the line number where the highlighted test is defined
  const highlightedLine = useMemo(() => {
    if (!highlightedTestName || !sourceContent) return -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(highlightedTestName)) {
        return i;
      }
    }
    return -1;
  }, [highlightedTestName, sourceContent, lines]);

  // No file selected - show file browser
  if (!selectedSourceFile) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-semibold text-sm">Source Code</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Select a test file to view its implementation
          </p>
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar">
          {testFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileCode className="w-10 h-10 mb-3 opacity-40" />
              <div className="text-sm">No test files discovered yet</div>
              <div className="text-xs mt-1">Wait for the first test run to complete</div>
            </div>
          ) : (
            <div className="py-2">
              {Array.from(fileTree.entries()).map(([dir, files]) => (
                <div key={dir} className="mb-1">
                  <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                    <FolderOpen className="w-3.5 h-3.5" />
                    {dir}/
                  </div>
                  {files.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => navigateToSource(file.path)}
                      className={cn(
                        "w-full flex items-center gap-2 pl-8 pr-4 py-1.5 text-sm transition-colors",
                        "hover:bg-accent/50",
                        selectedSourceFile === file.path && "bg-primary/10"
                      )}
                    >
                      <File className={cn(
                        "w-3.5 h-3.5 flex-shrink-0",
                        file.status === "failed" ? "text-red-500" : "text-muted-foreground"
                      )} />
                      <span className="font-mono text-xs truncate">{file.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* File header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <button
          onClick={() => {
            setSourceContent(null);
            useDashboardStore.getState().setSelectedSourceFile(null);
          }}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Back to file list"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <FileCode className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="font-mono text-xs text-foreground truncate">
          {sourceContent?.relativePath || selectedSourceFile.split("/").pop()}
        </span>
        {sourceContent && (
          <span className="text-xs text-muted-foreground ml-auto">
            {sourceContent.lineCount} lines
          </span>
        )}
      </div>

      {/* Source content */}
      <div ref={codeRef} className="flex-1 overflow-auto custom-scrollbar bg-muted/20">
        {sourceLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading source...
          </div>
        ) : !sourceContent ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Failed to load source file
          </div>
        ) : (
          <div className="font-mono text-xs leading-relaxed">
            {lines.map((line, i) => {
              const isHighlighted = highlightedLine >= 0 && i >= highlightedLine - 1 && i <= highlightedLine + 15;
              const isTarget = i === highlightedLine;

              return (
                <div
                  key={i}
                  ref={isTarget ? highlightRef : undefined}
                  className={cn(
                    "flex hover:bg-accent/30 transition-colors",
                    isHighlighted && "bg-primary/8",
                    isTarget && "bg-primary/15 border-l-2 border-primary"
                  )}
                >
                  <span className="w-12 flex-shrink-0 text-right pr-3 py-px text-muted-foreground/50 select-none border-r border-border/30">
                    {i + 1}
                  </span>
                  <pre className="flex-1 pl-4 pr-4 py-px whitespace-pre overflow-x-auto">
                    {highlightLine(line)}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
