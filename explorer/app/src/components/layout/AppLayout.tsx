// React import not needed with react-jsx runtime
import { useAppStore } from "../../stores/appStore";
import { BrandHeader } from "./BrandHeader";
import { AppModeBar } from "./AppModeBar";
import { LeftPanel } from "./LeftPanel";
import { MainContent } from "./MainContent";
import { BottomPanel } from "./BottomPanel";
import { BrandFooter } from "./BrandFooter";
import { cn } from "../../utils";
import { SettingsView, SettingsSidePanel } from "../settings/SettingsView";

export function AppLayout() {
  const { panels, mainView } = useAppStore();
  const showSettings = mainView === "settings";

  return (
    <div className="flex flex-col h-screen">
      {/* Brand Superapp Masthead */}
      <BrandHeader />

      {/* Explorer App Modes Bar */}
      <AppModeBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div
          className={cn(
            "panel-transition bg-card border-r border-gray-200 dark:border-gray-800",
            panels.left ? "w-80" : "w-0",
          )}
        >
          {panels.left && (
            <div className="h-full overflow-hidden">
              <LeftPanel />
            </div>
          )}
        </div>

        {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden">
              {showSettings ? (
                <div className="h-full flex overflow-hidden bg-background text-foreground">
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-muted/30">
                      <nav className="flex items-center space-x-2 text-sm">
                        <span className="font-medium text-foreground">Settings</span>
                      </nav>
                    </div>
                    <div className="p-6 space-y-4 w-full max-w-6xl mx-auto">
                      <SettingsView />
                    </div>
                  </div>
                  {panels.right && <SettingsSidePanel />}
                </div>
              ) : (
                <MainContent />
              )}
            </div>

          {/* Bottom Panel */}
          {panels.bottom && (
            <div className="h-48 border-t border-gray-200 dark:border-gray-800 bg-card">
              <BottomPanel />
            </div>
          )}
        </div>
      </div>

      {/* Superapp Footer */}
      <BrandFooter />
    </div>
  );
}
