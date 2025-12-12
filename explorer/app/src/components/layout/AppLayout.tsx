// React import not needed with react-jsx runtime
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { BrandHeader } from "./BrandHeader";
import { AppModeBar } from "./AppModeBar";
import { ExplorerMainContent } from "./MainContent";
import { BottomPanel } from "./BottomPanel";
import { BrandFooter } from "./BrandFooter";
import { cn, joinPath, sanitizePath } from "../../utils";
import { SettingsView, SettingsSidePanel } from "../settings/SettingsView";
import { AccountsView, AccountsSidePanel } from "../accounts/AccountsView";
import { ExplorerAccountPanel } from "../explorer/ExplorerAccountPanel";
import { ExplorerNavigation } from "../explorer/ExplorerNavigation";
import { WriterNavigation } from "../writer/WriterNavigation";
import { WriterMainContent } from "../writer/WriterMainContent";
import type { ExplorerSection, ManagedAccountType, PanelState, WriterSection } from "../../types";

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
    setExplorerSection,
    setExplorerAccountKey,
    explorerSection,
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
      const section = (relativePath.replace(/^\/writer\/?/, "") || "backend") as WriterSection;
      const allowed: WriterSection[] = [
        "backend",
        "auth",
        "actions",
        "configuration",
        "schema",
      ];
      if (allowed.includes(section)) {
        setWriterSection(section);
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

    const explorerRoute = parseExplorerPath(relativePath);
    if (!explorerRoute) return;

    if (activeApp !== "explorer") setActiveApp("explorer");
    if (mainView !== "content") setMainView("content");

    if (explorerRoute.section === "account") {
      setExplorerSection("account");
      setExplorerAccountKey(explorerRoute.accountKey);
      if (explorerRoute.accountKey) {
        const normalizedPath = sanitizePath(explorerRoute.path || "/");
        const resolvedPath = joinPath(
          "mutable",
          "accounts",
          explorerRoute.accountKey,
          normalizedPath === "/" ? "" : normalizedPath,
        );
        if (resolvedPath !== currentPath) {
          navigateToPath(normalizedPath, {
            section: "account",
            accountKey: explorerRoute.accountKey,
          });
        }
        ensureRightPanelOpen();
      }
      return;
    }

    setExplorerSection("index");
    const normalizedIndexPath = sanitizePath(explorerRoute.path || "/");
    if (normalizedIndexPath !== currentPath) {
      navigateToPath(normalizedIndexPath, { section: "index" });
    }
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
    setExplorerSection,
    setExplorerAccountKey,
  ]);

  const parseExplorerPath = (
    routePath: string,
  ): { section: ExplorerSection; path: string; accountKey: string | null } | null => {
    if (!routePath.startsWith("/explorer")) return null;
    const raw = routePath.replace(/^\/explorer\/?/, "");
    if (!raw) return { section: "index", path: "/", accountKey: null };
    const segments = raw
      .split("/")
      .filter(Boolean)
      .map((s) => decodeURIComponent(s));

    if (segments[0] === "account") {
      const accountKey = segments[1] || null;
      const pathSegments = segments.slice(2);
      const joined = pathSegments.join("/");
      const path = joined ? `/${joined}` : "/";
      return {
        section: "account",
        accountKey,
        path,
      };
    }

    if (segments[0] === "index") {
      const joined = segments.slice(1).join("/");
      return {
        section: "index",
        accountKey: null,
        path: joined ? `/${joined}` : "/",
      };
    }

    return {
      section: "index",
      accountKey: null,
      path: segments.length ? `/${segments.join("/")}` : "/",
    };
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
              {leftPanelContent(showSettings, showAccounts, activeApp, explorerSection)}
            </div>
          )}
        </div>

        {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden">
              {renderMainContent({
                showSettings,
                showAccounts,
                panels,
                accountCreationType,
                setAccountCreationType,
                explorerSection,
                activeApp,
              })}
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

function leftPanelContent(
  showSettings: boolean,
  showAccounts: boolean,
  activeApp: string,
  explorerSection: ExplorerSection,
) {
  if (showSettings) return <SimpleLeftPanel title="Settings" />;
  if (showAccounts) return <SimpleLeftPanel title="Accounts" />;
  if (activeApp === "writer") return <WriterLeftPanel />;
  if (activeApp === "explorer" && explorerSection === "account") {
    return <ExplorerLeftPanel label="Account Explorer" />;
  }
  return <ExplorerLeftPanel label="Explorer" />;
}

function renderMainContent(
  params: {
    showSettings: boolean;
    showAccounts: boolean;
    panels: PanelState;
    accountCreationType: ManagedAccountType;
    setAccountCreationType: (type: ManagedAccountType) => void;
    explorerSection: ExplorerSection;
    activeApp: string;
  },
) {
  const {
    showSettings,
    showAccounts,
    panels,
    accountCreationType,
    setAccountCreationType,
    explorerSection,
    activeApp,
  } = params;

  if (showSettings) {
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
        {panels.right && <SettingsSidePanel />}
      </div>
    );
  }

  if (showAccounts) {
    return (
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
    );
  }

  if (activeApp === "writer") {
    return <WriterMainContent />;
  }

  return (
    <div className="h-full flex overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-hidden">
        <ExplorerMainContent />
      </div>
      {panels.right && explorerSection === "account" && (
        <div className="w-[360px] border-l border-border bg-card">
          <div className="h-full overflow-auto custom-scrollbar p-4">
            <ExplorerAccountPanel />
          </div>
        </div>
      )}
    </div>
  );
}

function ExplorerLeftPanel({ label }: { label: string }) {
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

function WriterLeftPanel() {
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

function SimpleLeftPanel({ title }: { title: string }) {
  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          {title}
        </h2>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="p-4 text-sm text-muted-foreground">
          Select an item on the right.
        </div>
      </div>
    </div>
  );
}
