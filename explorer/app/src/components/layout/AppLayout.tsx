// React import not needed with react-jsx runtime
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { BrandHeader } from "./BrandHeader";
import { AppModeBar } from "./AppModeBar";
import { LeftPanel } from "./LeftPanel";
import { MainContent } from "./MainContent";
import { BottomPanel } from "./BottomPanel";
import { BrandFooter } from "./BrandFooter";
import { cn } from "../../utils";
import { SettingsView, SettingsSidePanel } from "../settings/SettingsView";
import { AccountsView, AccountsSidePanel } from "../accounts/AccountsView";
import type { ManagedAccountType } from "../../types";

export function AppLayout() {
  const {
    panels,
    mainView,
    bottomMaximized,
    toggleBottomPanelMaximized,
    togglePanel,
    navigateToPath,
    currentPath,
    activeApp,
    setActiveApp,
    setMainView,
    setWriterSection,
    ensureRightPanelOpen,
  } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();
  const showSettings = mainView === "settings";
  const showAccounts = mainView === "accounts";
  const [accountCreationType, setAccountCreationType] = useState<ManagedAccountType>("account");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCtrlZ = event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z";
      if (!isCtrlZ) return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isEditable = target.isContentEditable ||
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT";
        if (isEditable) return;
      }

      event.preventDefault();
      if (!panels.bottom) {
        togglePanel("bottom");
      }
      toggleBottomPanelMaximized();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panels.bottom, toggleBottomPanelMaximized, togglePanel]);

  useEffect(() => {
    const relativePath = location.pathname;

    if (relativePath.startsWith("/writer")) {
      if (activeApp !== "writer") setActiveApp("writer");
      if (mainView !== "content") setMainView("content");
      ensureRightPanelOpen();
      const section = relativePath.replace(/^\/writer\/?/, "") || "backend";
      const allowed: Array<typeof setWriterSection extends (arg: infer A) => any ? A : never> = [
        "backend",
        "auth",
        "actions",
        "configuration",
        "schema",
      ];
      if (allowed.includes(section as any)) {
        setWriterSection(section as any);
      } else {
        setWriterSection("backend");
      }
      return;
    }
    if (relativePath.startsWith("/accounts")) {
      if (mainView !== "accounts") setMainView("accounts");
      ensureRightPanelOpen();
      return;
    }
    if (relativePath.startsWith("/settings")) {
      if (mainView !== "settings") setMainView("settings");
      ensureRightPanelOpen();
      return;
    }
    if (!relativePath.startsWith("/explorer")) return;

    const explorerPath = parseExplorerPath(relativePath);
    if (explorerPath !== null && explorerPath !== currentPath) {
      navigateToPath(explorerPath);
    }
    if (activeApp !== "explorer") setActiveApp("explorer");
    if (mainView !== "content") setMainView("content");
    ensureRightPanelOpen();
  }, [
    location.pathname,
    currentPath,
    navigateToPath,
    activeApp,
    setActiveApp,
    setMainView,
    mainView,
    setWriterSection,
    ensureRightPanelOpen,
    navigate,
  ]);

  const parseExplorerPath = (routePath: string) => {
    if (!routePath.startsWith("/explorer")) return null;
    const raw = routePath.replace(/^\/explorer\/?/, "");
    if (!raw) return "/";
    const segments = raw
      .split("/")
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));
    return "/" + segments.join("/");
  };

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
              ) : showAccounts ? (
                <div className="h-full flex overflow-hidden bg-background text-foreground">
                  <div className="flex-1 overflow-auto custom-scrollbar">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-muted/30">
                      <nav className="flex items-center space-x-2 text-sm">
                        <span className="font-medium text-foreground">Accounts</span>
                      </nav>
                    </div>
                    <div className="p-6 space-y-4 w-full max-w-6xl mx-auto">
                      <AccountsView />
                    </div>
                  </div>
                  {panels.right && (
                    <div className="w-[360px] border-l border-border bg-card">
                      <div className="h-full overflow-auto custom-scrollbar p-4">
                        <AccountsSidePanel
                          creationType={accountCreationType}
                          setCreationType={setAccountCreationType}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <MainContent />
              )}
            </div>

          {/* Bottom Panel */}
          {panels.bottom && (
            <div
              className={cn(
                "border-t border-gray-200 dark:border-gray-800 bg-card",
                bottomMaximized ? "h-[70vh]" : "h-48",
              )}
            >
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
