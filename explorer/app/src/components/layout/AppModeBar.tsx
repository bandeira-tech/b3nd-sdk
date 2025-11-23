// React import not needed with react-jsx runtime
import { useAppStore } from '../../stores/appStore';
import { FolderTree, Search, Eye, PanelLeftOpen, PanelBottomOpen, PenSquare, Compass, PanelRightOpen } from 'lucide-react';
import { cn } from '../../utils';
import type { AppExperience, AppMode } from '../../types';
import type { ReactNode } from 'react';

export function AppModeBar() {
  const { mode, setMode, togglePanel, panels, activeApp, setActiveApp, setMainView, mainView } = useAppStore();

  const apps: Array<{ key: AppExperience; label: string; icon: ReactNode }> = [
    {
      key: 'explorer',
      label: 'Explorer',
      icon: <Compass className="h-4 w-4" />,
    },
    {
      key: 'writer',
      label: 'Writer',
      icon: <PenSquare className="h-4 w-4" />,
    },
  ];

  const modes: Array<{ key: AppMode; label: string; icon: ReactNode }> = [
    {
      key: 'filesystem',
      label: 'Navigate',
      icon: <FolderTree className="h-4 w-4" />,
    },
    {
      key: 'search',
      label: 'Search',
      icon: <Search className="h-4 w-4" />,
    },
    {
      key: 'watched',
      label: 'Watched',
      icon: <Eye className="h-4 w-4" />,
    },
  ];

  return (
    <div className="h-12 bg-background border-b border-border flex items-center justify-between px-4 gap-4">
      {/* Left side - Panel toggles */}
      <div className="flex items-center space-x-1">
        <button
          onClick={() => togglePanel('left')}
          className={cn(
            "p-2 rounded hover:bg-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            panels.left && "bg-accent"
          )}
          title="Toggle navigation panel (Ctrl+B)"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>

        <button
          onClick={() => togglePanel('bottom')}
          className={cn(
            "p-2 rounded hover:bg-accent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            panels.bottom && "bg-accent"
          )}
          title="Toggle bottom panel (Ctrl+Shift+B)"
        >
          <PanelBottomOpen className="h-4 w-4" />
        </button>
      </div>

      {/* Center - App switcher + contextual modes */}
      <div className="flex items-center space-x-2">
        <div className="flex items-center bg-muted rounded-lg p-1">
          {apps.map(({ key, label, icon }) => (
            <button
            key={key}
            onClick={() => {
              if (panels.right) setMainView('content');
              setActiveApp(key);
            }}
              className={cn(
                "flex items-center space-x-2 px-3 py-1.5 rounded text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeApp === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>

        {activeApp === 'explorer' && (
          <div className="hidden md:flex items-center bg-muted rounded-lg p-1">
            {modes.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={cn(
                  "flex items-center space-x-2 px-3 py-1.5 rounded text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right side - Additional controls */}
      <div className="flex items-center space-x-1">
        {(activeApp === 'writer' || mainView === 'settings') && (
          <button
            onClick={() => togglePanel('right')}
            className={cn(
              "p-2 rounded hover:bg-accent transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              panels.right && "bg-accent"
            )}
            title="Toggle right panel"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
