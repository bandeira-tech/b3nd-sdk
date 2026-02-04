import { useAppStore } from "../../../stores/appStore";
import { ExplorerMainContent } from "../MainContent";
import { ExplorerAccountPanel } from "../../explorer/ExplorerAccountPanel";
import { RightPanel } from "../RightPanel";

export function ExplorerLayoutSlot() {
  const panels = useAppStore((state) => state.panels);
  const explorerSection = useAppStore((state) => state.explorerSection);
  const setPanelOpen = useAppStore((state) => state.setPanelOpen);

  const rightPanelOpen = panels.right;
  const showAccountScope = explorerSection === "account";

  return (
    <div className="h-full flex overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-hidden">
        <ExplorerMainContent />
      </div>
      {rightPanelOpen && (
        showAccountScope
          ? (
            <div className="w-[360px] border-l border-border bg-card">
              <div className="h-full flex flex-col">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    Account Scope
                  </h2>
                  <button
                    onClick={() => setPanelOpen("right", false)}
                    className="p-1 rounded hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Close panel"
                  >
                    <span className="sr-only">Close</span>
                    &times;
                  </button>
                </div>
                <div className="flex-1 overflow-auto custom-scrollbar p-4">
                  <ExplorerAccountPanel />
                </div>
              </div>
            </div>
          )
          : (
            <div className="w-[360px] border-l border-border bg-card">
              <RightPanel />
            </div>
          )
      )}
    </div>
  );
}
