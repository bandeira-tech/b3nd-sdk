// React import not needed with react-jsx runtime
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore, useActiveBackend } from "../../stores/appStore";
import { RIG_EXPLORER_BASE_PATH, cn, routeForExplorerPath, sanitizePath, joinPath } from "../../utils";
import { ContentViewer } from "./ContentViewer";
import { FileText, User, Database, PenSquare, ChevronRight, KeyRound } from "lucide-react";
import { WriterMainContent } from "../writer/WriterMainContent";
import type { NavigationNode, WriterSection } from "../../types";

export function MainContent() {
  const mode = useAppStore((state) => state.mode);
  const currentPath = useAppStore((state) => state.currentPath);
  const activeApp = useAppStore((state) => state.activeApp);
  const explorerSection = useAppStore((state) => state.explorerSection);
  const explorerIndexPath = useAppStore((state) => state.explorerIndexPath);
  const explorerAccountKey = useAppStore((state) => state.explorerAccountKey);
  const explorerAccountPath = useAppStore((state) => state.explorerAccountPath);
  const navigate = useNavigate();

  if (activeApp === "writer") {
    return <WriterMainContent />;
  }

  const normalizedIndexPath = sanitizePath(explorerIndexPath || "/");
  const normalizedAccountPath = sanitizePath(explorerAccountPath || "/");

  const renderIndexContent = () => {
    switch (mode) {
      case "filesystem":
        return <ContentViewer path={normalizedIndexPath} />;
      case "search":
        return <SearchView />;
      case "watched":
        return <WatchedPathsView />;
      default:
        return <ContentViewer path={normalizedIndexPath} />;
    }
  };

  const renderAccountContent = () => {
    if (!explorerAccountKey) {
      return <AccountScopeEmptyState />;
    }

    const relativePathForAccount = (targetPath: string) => {
      return relativeAccountPath(explorerAccountKey, targetPath);
    };

    const buildRoute = (path: string) =>
      routeForExplorerPath(relativePathForAccount(path), {
        section: "account",
        accountKey: explorerAccountKey,
      });

    if (normalizedAccountPath === "/") {
      return (
        <AccountRootDirectory
          accountKey={explorerAccountKey}
          onNavigate={(targetPath) => {
            navigate(routeForExplorerPath(targetPath, {
              section: "account",
              accountKey: explorerAccountKey,
            }));
          }}
        />
      );
    }

    switch (mode) {
      case "filesystem":
        return (
          <ContentViewer
            path={currentPath}
            buildRoute={buildRoute}
          />
        );
      case "search":
        return <SearchView />;
      case "watched":
        return <WatchedPathsView />;
      default:
        return (
          <ContentViewer
            path={currentPath}
            buildRoute={buildRoute}
          />
        );
    }
  };

  return (
    <div className="h-full overflow-auto custom-scrollbar">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-muted/30">
        {activeApp === "writer" ? (
          <WriterBreadcrumb />
        ) : (
          explorerSection === "account"
            ? (
              <AccountBreadcrumb
                accountKey={explorerAccountKey}
                path={normalizedAccountPath}
              />
            )
            : <Breadcrumb path={normalizedIndexPath} />
        )}
      </div>

      <div className="flex-1">
        {explorerSection === "account" ? renderAccountContent() : renderIndexContent()}
      </div>
    </div>
  );
}

function Breadcrumb({ path }: { path: string }) {
  const navigate = useNavigate();
  const segments = path === "/" ? [] : path.split("/").filter(Boolean);

  return (
    <nav className="flex items-center space-x-1 text-sm">
      <button
        onClick={() => navigate(RIG_EXPLORER_BASE_PATH)}
        className="px-2 py-1 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Database className="h-4 w-4" />
      </button>

      {segments.map((segment, index) => {
        const pathTo = "/" + segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;

        return (
          <Fragment key={pathTo}>
            <span className="text-muted-foreground">/</span>
            <button
              onClick={() => navigate(routeForExplorerPath(pathTo))}
              className={`px-2 py-1 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                isLast
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              disabled={isLast}
            >
              {segment}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}

function AccountBreadcrumb(
  { accountKey, path }: { accountKey: string | null; path: string },
) {
  const navigate = useNavigate();
  const segments = path === "/" ? [] : path.split("/").filter(Boolean);
  const hasAccount = Boolean(accountKey);

  return (
    <nav className="flex items-center space-x-2 text-sm">
      <div className="flex items-center space-x-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <button
          onClick={() =>
            navigate(
              routeForExplorerPath("/", {
                section: "account",
                accountKey: accountKey ?? undefined,
              }),
            )}
          className="px-2 py-1 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          disabled={!hasAccount}
        >
          Account
        </button>
      </div>
      {hasAccount
        ? (
          <span className="font-mono text-xs px-2 py-1 rounded bg-muted text-foreground border border-border">
            {accountKey}
          </span>
        )
        : <span className="text-muted-foreground">Add an account key</span>}

      {hasAccount &&
        segments.map((segment, index) => {
          const pathTo = "/" + segments.slice(0, index + 1).join("/");
          const isLast = index === segments.length - 1;

          return (
            <Fragment key={pathTo}>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <button
                onClick={() => navigate(routeForExplorerPath(pathTo, {
                  section: "account",
                  accountKey: accountKey ?? undefined,
                }))}
                className={cn(
                  "px-2 py-1 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                  isLast
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
                disabled={isLast || !hasAccount}
              >
                {segment}
              </button>
            </Fragment>
          );
        })}
    </nav>
  );
}

function AccountScopeEmptyState() {
  return (
    <div className="p-6 text-center text-muted-foreground space-y-2">
      <KeyRound className="h-10 w-10 mx-auto mb-2 opacity-60" />
      <p className="text-sm text-foreground">Provide an account public key to browse scoped data.</p>
      <p className="text-sm">
        Use the right panel or visit a URL like <code className="font-mono">/explorer/account/&lt;pubkey&gt;</code>.
      </p>
    </div>
  );
}

function AccountRootDirectory(
  { accountKey, onNavigate }: {
    accountKey: string;
    onNavigate: (path: string) => void;
  },
) {
  const activeBackend = useActiveBackend();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Array<NavigationNode & { protocol: "mutable" | "immutable" }>>([]);

  useEffect(() => {
    const load = async () => {
      if (!activeBackend?.adapter) {
        setError("Active backend is required");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const targets: Array<"mutable" | "immutable"> = ["mutable", "immutable"];
        const results: Array<NavigationNode & { protocol: "mutable" | "immutable" }> = [];
        for (const protocol of targets) {
          const basePath = joinPath(protocol, "accounts", accountKey);
          const response = await activeBackend.adapter.listPath(basePath, { page: 1, limit: 50 });
          for (const node of response.data) {
            results.push({ ...node, protocol });
          }
        }
        setItems(results);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [accountKey, activeBackend]);

  if (loading) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        Loading account paths...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">
        Failed to load account paths: {error}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No content found for this account.
      </div>
    );
  }

  const sorted = [...items].sort((a, b) => {
    if (a.protocol !== b.protocol) {
      return a.protocol.localeCompare(b.protocol);
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-lg font-semibold">Account namespaces</h3>
      <div className="space-y-2">
        {sorted.map((item) => (
          <button
            key={`${item.protocol}-${item.path}`}
            onClick={() => onNavigate(relativeAccountPath(accountKey, item.path))}
            className="w-full flex items-center space-x-3 p-3 rounded-lg border border-border hover:border-primary hover:bg-accent transition-colors text-left"
          >
            <div className="flex-shrink-0">
              {item.protocol === "immutable"
                ? <span className="text-xs px-2 py-1 rounded bg-indigo-500/10 text-indigo-700 border border-indigo-500/30">immutable</span>
                : <span className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-700 border border-emerald-500/30">mutable</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{item.name}</div>
              {item.record && (
                <div className="text-xs text-muted-foreground">
                  Modified: {new Date(item.record.ts).toLocaleString()}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchView() {
  const { searchQuery, setSearchQuery, addToSearchHistory, searchHistory } = useAppStore();

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    addToSearchHistory(searchQuery);
  };

  return (
    <div className="p-4 space-y-4">
      <form onSubmit={handleSearchSubmit} className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Search paths and content
        </label>
        <input
          type="text"
          placeholder="Search paths and content..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full p-2 border border-border rounded bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </form>

      {searchHistory.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">
            Recent Searches
          </div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.slice(0, 5).map((query) => (
              <button
                key={query}
                onClick={() => setSearchQuery(query)}
                className="px-3 py-1.5 rounded border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {query}
              </button>
            ))}
          </div>
        </div>
      )}

      <SearchResults />
    </div>
  );
}

function relativeAccountPath(accountKey: string, targetPath: string): string {
  const normalizedTarget = sanitizePath(targetPath || "/");
  const mutablePrefix = `/mutable/accounts/${accountKey}`;
  const immutablePrefix = `/immutable/accounts/${accountKey}`;
  if (normalizedTarget.startsWith(mutablePrefix)) {
    const remainder = normalizedTarget.slice(mutablePrefix.length) || "/";
    const trimmed = sanitizePath(remainder);
    return trimmed === "/" ? "/mutable" : `/mutable${trimmed}`;
  }
  if (normalizedTarget.startsWith(immutablePrefix)) {
    const remainder = normalizedTarget.slice(immutablePrefix.length) || "/";
    const trimmed = sanitizePath(remainder);
    return trimmed === "/" ? "/immutable" : `/immutable${trimmed}`;
  }
  if (normalizedTarget === "/") return "/";
  // If the path already starts with a protocol, keep it relative
  const parts = normalizedTarget.split("/").filter(Boolean);
  if (parts[0] === "mutable" || parts[0] === "immutable") {
    return "/" + parts.join("/");
  }
  return "/" + parts.join("/");
}


function SearchResults() {
  return (
    <div className="p-4">
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>Search results will appear here</p>
        <p className="text-sm mt-2">
          Enter a search query above to get started
        </p>
      </div>
    </div>
  );
}

function WatchedPathsView() {
  return (
    <div className="p-4">
      <div className="text-center py-12 text-muted-foreground">
        <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No watched paths configured</p>
        <p className="text-sm mt-2">
          Add paths to your watchlist to monitor changes
        </p>
      </div>
    </div>
  );
}

function WriterBreadcrumb() {
  const { writerSection, setWriterSection } = useAppStore();

  const labels: Record<WriterSection, string> = {
    backend: "Backend",
    auth: "Auth",
    actions: "Actions",
    configuration: "Configuration",
    schema: "Schema",
  };

  return (
    <nav className="flex items-center space-x-2 text-sm">
      <div className="flex items-center space-x-2">
        <PenSquare className="h-4 w-4 text-muted-foreground" />
        <button
          onClick={() => setWriterSection("backend")}
          className="px-2 py-1 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Writer
        </button>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
      <span className="text-foreground font-medium">{labels[writerSection]}</span>
    </nav>
  );
}
