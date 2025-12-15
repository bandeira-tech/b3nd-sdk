import { useAppStore } from "../../../stores/appStore";
import { ExplorerNavigation } from "../../explorer/ExplorerNavigation";

export function ExplorerLeftSlot() {
  const explorerSection = useAppStore((state) => state.explorerSection);
  const label = explorerSection === "account" ? "Account Explorer" : "Explorer";

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          {label}
        </h2>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <ExplorerNavigation />
      </div>
    </div>
  );
}
