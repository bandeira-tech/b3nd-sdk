// React import not needed with react-jsx runtime
import { useAppStore } from "../../stores/appStore";
import { WriterNavigation } from "../writer/WriterNavigation";
import { ExplorerNavigation } from "../explorer/ExplorerNavigation";

export function LeftPanel() {
  const { activeApp } = useAppStore();

  if (activeApp === "writer") {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Navigation
          </h2>
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar">
          <WriterNavigation />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Explorer
        </h2>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <ExplorerNavigation />
      </div>
    </div>
  );
}
