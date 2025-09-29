import React from "react";
import { useAppStore } from "../../stores/appStore";
import { BrandHeader } from "./BrandHeader";
import { AppModeBar } from "./AppModeBar";
import { LeftPanel } from "./LeftPanel";
import { MainContent } from "./MainContent";
import { RightPanel } from "./RightPanel";
import { BottomPanel } from "./BottomPanel";
import { BrandFooter } from "./BrandFooter";
import { cn } from "../../utils";

export function AppLayout() {
  const { panels } = useAppStore();

  return (
    <div className="flex flex-col h-screen">
      {/* Brand Superapp Masthead */}
      <BrandHeader />

      {/* Explorer App Modes Bar */}
      <AppModeBar />

      {/* Main Content Area */}
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
            <MainContent />
          </div>

          {/* Bottom Panel */}
          {panels.bottom && (
            <div className="h-48 border-t border-gray-200 dark:border-gray-800 bg-card">
              <BottomPanel />
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div
          className={cn(
            "panel-transition bg-card border-l border-gray-200 dark:border-gray-800",
            panels.right ? "w-80" : "w-0",
          )}
        >
          {panels.right && (
            <div className="h-full overflow-hidden">
              <RightPanel />
            </div>
          )}
        </div>
      </div>

      {/* Superapp Footer */}
      <BrandFooter />
    </div>
  );
}
