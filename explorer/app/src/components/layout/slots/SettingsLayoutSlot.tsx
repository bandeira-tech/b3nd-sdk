import { SettingsView, SettingsSidePanel } from "../../settings/SettingsView";

export function SettingsLayoutSlot() {
  return (
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
      <SettingsSidePanel />
    </div>
  );
}
