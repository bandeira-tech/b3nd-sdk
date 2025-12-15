import type { ComponentType } from "react";
import { useAppStore } from "../../stores/appStore";
import { ExplorerLeftSlot } from "./slots/ExplorerLeftSlot";
import { ExplorerLayoutSlot } from "./slots/ExplorerLayoutSlot";
import { WriterLeftSlot } from "./slots/WriterLeftSlot";
import { WriterLayoutSlot } from "./slots/WriterLayoutSlot";
import { SettingsLayoutSlot } from "./slots/SettingsLayoutSlot";
import { AccountsLayoutSlot } from "./slots/AccountsLayoutSlot";
import { SimpleLeftSlot } from "./slots/SimpleLeftSlot";
import type { AppMode } from "../../types";

type LayoutSlotKey = "settings" | "accounts" | "writer" | "explorer";

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
};

export function useLayoutSlots() {
  const mainView = useAppStore((state) => state.mainView);
  const activeApp = useAppStore((state) => state.activeApp);
  const mode = useAppStore((state) => state.mode);

  const slotKey: LayoutSlotKey = (() => {
    if (mainView === "settings") return "settings";
    if (mainView === "accounts") return "accounts";
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
