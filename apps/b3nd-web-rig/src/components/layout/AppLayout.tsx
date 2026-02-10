// React import not needed with react-jsx runtime
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAppStore, rightPanelContextKey } from "../../stores/appStore";
import { BrandHeader } from "./BrandHeader";
import { AppModeBar } from "./AppModeBar";
import { BottomPanel } from "./BottomPanel";
import { BrandFooter } from "./BrandFooter";
import { cn, joinPath, sanitizePath } from "../../utils";
import { useLayoutSlots } from "./useLayoutSlots";
import type { WriterSection, ExplorerSection } from "../../types";

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
    setPanelOpen,
    setExplorerSection,
    setExplorerAccountKey,
  } = useAppStore();
  const location = useLocation();
  const { LeftSlot, MainSlot } = useLayoutSlots();
  const applyRightPanelPreference = useAppStore((state) => state.applyRightPanelPreference);
  const rightPanelKey = useAppStore((state) => rightPanelContextKey(state));

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
    applyRightPanelPreference();
  }, [rightPanelKey, applyRightPanelPreference]);

  useEffect(() => {
    const relativePath = location.pathname;

    if (relativePath.startsWith("/learn")) {
      if (activeApp !== "learn") setActiveApp("learn");
      if (mainView !== "content") setMainView("content");
      return;
    }
    if (relativePath.startsWith("/nodes")) {
      if (activeApp !== "nodes") setActiveApp("nodes");
      if (mainView !== "content") setMainView("content");
      return;
    }
    if (relativePath.startsWith("/dashboard")) {
      if (activeApp !== "dashboard") setActiveApp("dashboard");
      if (mainView !== "content") setMainView("content");
      return;
    }
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
        "shareable",
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
      setPanelOpen("right", true);
      return;
    }
    if (relativePath.startsWith("/settings")) {
      if (mainView !== "settings") setMainView("settings");
      setPanelOpen("right", true);
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
      setPanelOpen("right", Boolean(explorerRoute.accountKey));
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
    setPanelOpen("right", false);
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
              <LeftSlot />
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <MainSlot />
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
