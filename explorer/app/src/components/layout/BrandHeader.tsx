// React import not needed with react-jsx runtime
import { useAppStore } from '../../stores/appStore';
import { Settings, Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '../../utils';

export function BrandHeader() {
  const { theme, setTheme, togglePanel, panels } = useAppStore();

  const handleThemeToggle = () => {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun className="h-4 w-4" />;
      case 'dark':
        return <Moon className="h-4 w-4" />;
      case 'system':
        return <Monitor className="h-4 w-4" />;
    }
  };

  return (
    <header className="brand-header h-10 flex items-center justify-between px-4 text-sm">
      {/* Left side - Brand */}
      <div className="flex items-center space-x-4">
        <div className="font-semibold">b3nd</div>
        <div className="text-brand-fg/60">superapp</div>
      </div>

      {/* Right side - Global controls */}
      <div className="flex items-center space-x-2">
        <button
          onClick={handleThemeToggle}
          className={cn(
            "p-1.5 rounded hover:bg-white/10 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          )}
          title={`Current theme: ${theme}. Click to cycle themes.`}
        >
          {getThemeIcon()}
        </button>

        <button
          onClick={() => togglePanel('right')}
          className={cn(
            "p-1.5 rounded hover:bg-white/10 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
            panels.right && "bg-white/10"
          )}
          title="Toggle settings panel"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
