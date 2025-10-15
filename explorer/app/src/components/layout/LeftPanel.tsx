// React import not needed with react-jsx runtime
import { useAppStore } from "../../stores/appStore";
import { NavigationTree } from "./NavigationTree";
import { Search, Eye } from "lucide-react";

export function LeftPanel() {
  const { mode } = useAppStore();

  const renderContent = () => {
    switch (mode) {
      case "filesystem":
        return <NavigationTree />;
      case "search":
        return <SearchPanel />;
      case "watched":
        return <WatchedPathsPanel />;
      default:
        return <NavigationTree />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          {mode === "filesystem" && "Navigation"}
          {mode === "search" && "Search"}
          {mode === "watched" && "Watched Paths"}
        </h2>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        {renderContent()}
      </div>
    </div>
  );
}

function SearchPanel() {
  const { searchQuery, setSearchQuery, addToSearchHistory, searchHistory } =
    useAppStore();

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      addToSearchHistory(searchQuery);
      // TODO: Trigger search with backend adapter
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  return (
    <div className="p-4">
      <div className="flex items-center space-x-2 text-muted-foreground mb-4">
        <Search className="h-4 w-4" />
        <span className="text-sm">Search paths and content</span>
      </div>

      <form onSubmit={handleSearchSubmit} className="mb-4">
        <input
          type="text"
          placeholder="Search paths and content..."
          value={searchQuery}
          onChange={handleSearchChange}
          className="w-full p-2 border border-border rounded bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </form>

      {/* Search History */}
      {searchHistory.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">
            Recent Searches
          </div>
          <div className="space-y-1">
            {searchHistory.slice(0, 5).map((query, index) => (
              <button
                key={index}
                onClick={() => setSearchQuery(query)}
                className="block w-full text-left text-sm p-2 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring text-muted-foreground hover:text-foreground"
              >
                {query}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WatchedPathsPanel() {
  return (
    <div className="p-4">
      <div className="flex items-center space-x-2 text-muted-foreground">
        <Eye className="h-4 w-4" />
        <span className="text-sm">Watched paths will be implemented here</span>
      </div>
      <div className="mt-4 text-sm text-muted-foreground">
        No watched paths yet
      </div>
    </div>
  );
}
