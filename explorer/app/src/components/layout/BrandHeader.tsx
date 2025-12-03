// React import not needed with react-jsx runtime
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { Monitor, Moon, Settings, Sun, PenSquare, Compass, Users } from "lucide-react";
import { RIG_ACCOUNTS_PATH, RIG_EXPLORER_BASE_PATH, RIG_SETTINGS_PATH, RIG_WRITER_BASE_PATH, cn } from "../../utils";
import type { ReactNode } from "react";

export function BrandHeader() {
  const {
    theme,
    setTheme,
    mainView,
    activeApp,
    accounts,
    activeAccountId,
  } = useAppStore();
  const navigate = useNavigate();

  const activeAccount = accounts.find((a) => a.id === activeAccountId) || null;

  const handleThemeToggle = () => {
    const themes: Array<"light" | "dark" | "system"> = [
      "light",
      "dark",
      "system",
    ];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
  };

  const getThemeIcon = () => {
    switch (theme) {
      case "light":
        return <Sun className="h-4 w-4" />;
      case "dark":
        return <Moon className="h-4 w-4" />;
      case "system":
        return <Monitor className="h-4 w-4" />;
    }
  };

  return (
    <header className="brand-header h-10 flex items-center justify-between px-4 text-sm">
      {/* Left side - Brand */}
      <div className="flex items-center space-x-4">
        <div className="font-semibold">Rig</div>
        <div className="text-brand-fg/60">Firecat network</div>
      </div>

      {/* Center - App switcher */}
      <div className="flex items-center bg-white/5 rounded-lg p-1 space-x-1">
        <AppSwitchButton
          active={activeApp === "explorer"}
          label="Explorer"
          icon={<Compass className="h-4 w-4" />}
          onClick={() => {
            navigate(RIG_EXPLORER_BASE_PATH);
          }}
        />
        <AppSwitchButton
          active={activeApp === "writer"}
          label="Writer"
          icon={<PenSquare className="h-4 w-4" />}
          onClick={() => {
            navigate(RIG_WRITER_BASE_PATH);
          }}
        />
      </div>

      {/* Right side - Global controls */}
      <div className="flex items-center space-x-2">
        <div className="flex items-center gap-1">
          {activeAccount?.emoji && (
            <div className="text-lg leading-none">{activeAccount.emoji}</div>
          )}
          <button
          onClick={() => {
            navigate(RIG_ACCOUNTS_PATH);
          }}
            className={cn(
              "p-1.5 rounded hover:bg-white/10 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              mainView === "accounts" && "bg-white/10",
            )}
            title="Manage accounts"
          >
            <Users className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={handleThemeToggle}
          className={cn(
            "p-1.5 rounded hover:bg-white/10 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
          )}
          title={`Current theme: ${theme}. Click to cycle themes.`}
        >
          {getThemeIcon()}
        </button>

        <button
          onClick={() =>
            mainView === "settings"
              ? navigate(RIG_EXPLORER_BASE_PATH)
              : navigate(RIG_SETTINGS_PATH)}
          className={cn(
            "p-1.5 rounded hover:bg-white/10 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
            mainView === "settings" && "bg-white/10",
          )}
          title="Toggle settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function AppSwitchButton(
  { active, label, icon, onClick }: {
    active: boolean;
    label: string;
    icon: ReactNode;
    onClick: () => void;
  },
) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center space-x-2 px-3 py-1.5 rounded text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        active
          ? "bg-white/20 text-white shadow-sm"
          : "text-white/70 hover:text-white hover:bg-white/10",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
