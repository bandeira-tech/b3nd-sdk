// React import not needed with react-jsx runtime
import { Fragment } from "react";
import { useAppStore } from "../../stores/appStore";
import { ContentViewer } from "./ContentViewer";
import { FileText, User, Database, PenSquare, ChevronRight } from "lucide-react";
import { WriterMainContent } from "../writer/WriterMainContent";
import type { WriterSection } from "../../types";

export function MainContent() {
  const { mode, currentPath, activeApp } = useAppStore();

  const renderContent = () => {
    if (activeApp === "writer") {
      return <WriterMainContent />;
    }

    switch (mode) {
      case "filesystem":
        return <ContentViewer path={currentPath} />;
      case "search":
        return <SearchResults />;
      case "watched":
        return <WatchedPathsView />;
      default:
        return <ContentViewer path={currentPath} />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-muted/30">
        {activeApp === "writer" ? (
          <WriterBreadcrumb />
        ) : (
          <Breadcrumb path={currentPath} />
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {renderContent()}
      </div>
    </div>
  );
}

function Breadcrumb({ path }: { path: string }) {
  const { navigateToPath } = useAppStore();
  const segments = path === "/" ? [] : path.split("/").filter(Boolean);

  return (
    <nav className="flex items-center space-x-1 text-sm">
      <button
        onClick={() => navigateToPath("/")}
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
              onClick={() => navigateToPath(pathTo)}
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

function SearchResults() {
  return (
    <div className="p-4">
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>Search results will appear here</p>
        <p className="text-sm mt-2">
          Enter a search query in the left panel to get started
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
    config: "Configuration",
    backend: "Backend",
    app: "App",
    auth: "Auth",
  };

  return (
    <nav className="flex items-center space-x-2 text-sm">
      <div className="flex items-center space-x-2">
        <PenSquare className="h-4 w-4 text-muted-foreground" />
        <button
          onClick={() => setWriterSection("config")}
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
