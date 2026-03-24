import type { ComponentType } from "react";
import { useAppStore } from "../../stores/appStore";
import { ExplorerLeftSlot } from "./slots/ExplorerLeftSlot";
import { ExplorerLayoutSlot } from "./slots/ExplorerLayoutSlot";
import { WriterLeftSlot } from "./slots/WriterLeftSlot";
import { WriterLayoutSlot } from "./slots/WriterLayoutSlot";
import { DashboardLeftSlot } from "./slots/DashboardLeftSlot";
import { DashboardLayoutSlot } from "./slots/DashboardLayoutSlot";
import { NodesLeftSlot } from "../nodes/NodesLeftSlot";
import { NodesLayoutSlot } from "../nodes/NodesLayoutSlot";
import { LearnLeftSlot } from "../learn/LearnLeftSlot";
import { LearnLayoutSlot } from "../learn/LearnLayoutSlot";
import { ApiDocsLeftSlot } from "../api-docs/ApiDocsLeftSlot";
import { ApiDocsLayoutSlot } from "../api-docs/ApiDocsLayoutSlot";
import { EditorLeftSlotConnected } from "../editor/EditorLayoutSlot";
import { EditorMainSlotConnected } from "../editor/EditorLayoutSlot";
import { SettingsLayoutSlot } from "./slots/SettingsLayoutSlot";
import { AccountsLayoutSlot } from "./slots/AccountsLayoutSlot";
import { SimpleLeftSlot } from "./slots/SimpleLeftSlot";
import type { AppMode } from "../../types";

type LayoutSlotKey = "settings" | "accounts" | "editor" | "writer" | "explorer" | "dashboard" | "nodes" | "learn" | "api-docs";

type LayoutSlot = {
  Left: ComponentType;
  Main: ComponentType;
  rightPanelToggleVisible: (params: { mode: AppMode }) => boolean;
};

const layoutSlots: Record<LayoutSlotKey, LayoutSlot> = {
  settings: {
    Left: () => <SimpleLeftSlot title="Settings" />,
    Main: SettingsLayoutSlot,
    rightPanelToggleVisible: () => true,
  },
  accounts: {
    Left: () => <SimpleLeftSlot title="Accounts" />,
    Main: AccountsLayoutSlot,
    rightPanelToggleVisible: () => true,
  },
  editor: {
    Left: EditorLeftSlotConnected,
    Main: EditorMainSlotConnected,
    rightPanelToggleVisible: () => false,
  },
  writer: {
    Left: WriterLeftSlot,
    Main: WriterLayoutSlot,
    rightPanelToggleVisible: () => true,
  },
  explorer: {
    Left: ExplorerLeftSlot,
    Main: ExplorerLayoutSlot,
    rightPanelToggleVisible: ({ mode }) => mode === "filesystem",
  },
  dashboard: {
    Left: DashboardLeftSlot,
    Main: DashboardLayoutSlot,
    rightPanelToggleVisible: () => false,
  },
  nodes: {
    Left: NodesLeftSlot,
    Main: NodesLayoutSlot,
    rightPanelToggleVisible: () => true,
  },
  learn: {
    Left: LearnLeftSlot,
    Main: LearnLayoutSlot,
    rightPanelToggleVisible: () => false,
  },
  "api-docs": {
    Left: ApiDocsLeftSlot,
    Main: ApiDocsLayoutSlot,
    rightPanelToggleVisible: () => false,
  },
};

export function useLayoutSlots() {
  const mainView = useAppStore((state) => state.mainView);
  const activeApp = useAppStore((state) => state.activeApp);
  const mode = useAppStore((state) => state.mode);

  const slotKey: LayoutSlotKey = (() => {
    if (mainView === "settings") return "settings";
    if (mainView === "accounts") return "accounts";
    if (activeApp === "api-docs") return "api-docs";
    if (activeApp === "learn") return "learn";
    if (activeApp === "nodes") return "nodes";
    if (activeApp === "dashboard") return "dashboard";
    if (activeApp === "editor") return "editor";
    if (activeApp === "writer") return "writer";
    if (activeApp === "explorer") return "explorer";
    throw new Error("Unsupported layout slot configuration");
  })();

  const slot = layoutSlots[slotKey];
  if (!slot) {
    throw new Error(`Missing layout slot for key ${slotKey}`);
  }

  return {
    LeftSlot: slot.Left,
    MainSlot: slot.Main,
    rightPanelToggleVisible: slot.rightPanelToggleVisible({ mode }),
  };
}
