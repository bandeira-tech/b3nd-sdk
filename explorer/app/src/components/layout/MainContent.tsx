import React from 'react';
import { useAppStore } from '../../stores/appStore';
import { FileText, Folder, Calendar, User, Database } from 'lucide-react';

export function MainContent() {
  const { mode, currentPath } = useAppStore();

  const renderContent = () => {
    switch (mode) {
      case 'filesystem':
        return <FilesystemView />;
      case 'search':
        return <SearchResults />;
      case 'watched':
        return <WatchedPathsView />;
      default:
        return <FilesystemView />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb Navigation */}
      <div className="p-4 border-b border-border bg-muted/30">
        <Breadcrumb path={currentPath} />
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
  const segments = path === '/' ? [] : path.split('/').filter(Boolean);

  return (
    <nav className="flex items-center space-x-1 text-sm">
      <button
        onClick={() => navigateToPath('/')}
        className="px-2 py-1 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Database className="h-4 w-4" />
      </button>

      {segments.map((segment, index) => {
        const pathTo = '/' + segments.slice(0, index + 1).join('/');
        const isLast = index === segments.length - 1;

        return (
          <React.Fragment key={index}>
            <span className="text-muted-foreground">/</span>
            <button
              onClick={() => navigateToPath(pathTo)}
              className={`px-2 py-1 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                isLast
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
              disabled={isLast}
            >
              {segment}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function FilesystemView() {
  const { currentPath } = useAppStore();

  // Mock data for demonstration
  const items = [
    { name: 'users', type: 'directory', path: '/users', size: null, modified: new Date() },
    { name: 'apps', type: 'directory', path: '/apps', size: null, modified: new Date() },
  ];

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold mb-4">
        Directory: {currentPath}
      </h3>

      <div className="space-y-2">
        {items.map((item) => (
          <FileItem key={item.path} item={item} />
        ))}
      </div>

      {items.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>This directory is empty</p>
        </div>
      )}
    </div>
  );
}

function FileItem({ item }: { item: any }) {
  const { navigateToPath } = useAppStore();

  const handleClick = () => {
    if (item.type === 'directory') {
      navigateToPath(item.path);
    }
  };

  return (
    <div
      className="flex items-center space-x-3 p-3 rounded-lg hover:bg-accent cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={handleClick}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className="flex-shrink-0">
        {item.type === 'directory' ? (
          <Folder className="h-5 w-5 text-blue-500" />
        ) : (
          <FileText className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{item.name}</div>
        <div className="text-sm text-muted-foreground flex items-center space-x-4">
          {item.size && <span>{item.size}</span>}
          <span className="flex items-center space-x-1">
            <Calendar className="h-3 w-3" />
            <span>{item.modified.toLocaleDateString()}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function SearchResults() {
  return (
    <div className="p-4">
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>Search results will appear here</p>
        <p className="text-sm mt-2">Enter a search query in the left panel to get started</p>
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
        <p className="text-sm mt-2">Add paths to your watchlist to monitor changes</p>
      </div>
    </div>
  );
}
